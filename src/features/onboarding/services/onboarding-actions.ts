"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { z } from "zod";
import { headers } from "next/headers";
import { encryptCredentials } from "@/shared/lib/integration-secrets";
import { ensureWebhook, listNumbers, pickNumber, ycloudWebhookUrl } from "@/features/inbox/services/ycloud-connect";
import { starterPrompt, STARTER_AGENT_NAMES } from "@/features/agents/lib/starter-prompts";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const OnboardingSchema = z.object({
  useCase: z.enum(["setter", "soporte", "agendamiento", "general"]),
  businessName: z.string().min(1, "El nombre del negocio es requerido"),
  industry: z.string().optional(),
  description: z.string().optional(),
  ycloudApiKey: z.string().optional(),
  ycloudPhone: z.string().optional(),
  ycloudSigningSecret: z.string().optional(),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;
export type OnboardingResult =
  | { workspaceId: string; whatsappConnected?: boolean; error?: never }
  | { workspaceId?: never; whatsappConnected?: never; error: string };


// ─── Slug generator ───────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

// ─── Server action ────────────────────────────────────────────────────────────

export async function completeOnboarding(
  input: unknown,
): Promise<OnboardingResult> {
  // 1. Validate input
  const parsed = OnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const data = parsed.data;

  // 2. Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "No autorizado" };
  }

  // 3. Use service client to bypass RLS for the initial workspace creation
  //    (the user has no membership yet, so RLS blocks inserts)
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 4. Generate unique slug
  const baseSlug = generateSlug(data.businessName);
  const suffix = Math.random().toString(36).slice(2, 5);
  const slug = `${baseSlug}-${suffix}`;

  // 5. Create workspace
  const { data: workspace, error: wsError } = await serviceClient
    .from("workspaces")
    .insert({
      name: data.businessName,
      slug,
    })
    .select("id")
    .single();

  if (wsError || !workspace) {
    console.error("[completeOnboarding] workspace insert error:", wsError);
    return { error: "Error al crear el workspace" };
  }

  const workspaceId = workspace.id as string;

  // 6. Create membership (admin role)
  const { error: memberError } = await serviceClient
    .from("memberships")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      role: "admin",
      is_active: true,
    });

  if (memberError) {
    console.error("[completeOnboarding] membership insert error:", memberError);
    // Rollback workspace
    await serviceClient.from("workspaces").delete().eq("id", workspaceId);
    return { error: "Error al crear la membresía" };
  }

  // 7. Create business_info
  const { error: biError } = await serviceClient.from("business_info").insert({
    workspace_id: workspaceId,
    structured: {
      name: data.businessName,
      industry: data.industry ?? "",
    },
    free_text: data.description ?? "",
  });

  if (biError) {
    console.error("[completeOnboarding] business_info insert error:", biError);
    // Non-fatal — continue
  }

  // 8. Seed starter prompt
  const seededType = data.useCase === "general" ? "setter" : data.useCase;
  const promptBody = starterPrompt(
    data.useCase,
    data.businessName,
    STARTER_AGENT_NAMES[seededType],
  );

  const { data: promptRow, error: promptError } = await serviceClient
    .from("prompts")
    .insert({
      workspace_id: workspaceId,
      scope: "global",
      scope_ref: null,
      name: "Prompt principal",
    })
    .select("id")
    .single();

  if (!promptError && promptRow) {
    const promptId = (promptRow as { id: string }).id;

    const { data: versionRow, error: versionError } = await serviceClient
      .from("prompt_versions")
      .insert({
        workspace_id: workspaceId,
        prompt_id: promptId,
        version: 1,
        state: "published",
        body: promptBody,
        published_at: new Date().toISOString(),
        created_by: user.id,
      })
      .select("id")
      .single();

    if (!versionError && versionRow) {
      const versionId = (versionRow as { id: string }).id;
      await serviceClient
        .from("prompts")
        .update({ active_version_id: versionId })
        .eq("id", promptId);
    }
  }

  // 8b. Seed the 3 agents (Setter / Soporte / Agendamiento). The chosen use case
  // is active (general → setter); each agent gets its own mode-scoped prompt.
  const activeType = seededType;
  const AGENT_NAMES = STARTER_AGENT_NAMES;
  for (const type of ["setter", "soporte", "agendamiento"] as const) {
    const body =
      type === activeType
        ? promptBody
        : starterPrompt(type, data.businessName, STARTER_AGENT_NAMES[type]);

    const { data: agentPrompt } = await serviceClient
      .from("prompts")
      .insert({
        workspace_id: workspaceId,
        scope: "mode",
        scope_ref: type,
        name: `Agente ${type}`,
      })
      .select("id")
      .single();

    const agentPromptId = (agentPrompt as { id: string } | null)?.id ?? null;
    if (agentPromptId) {
      const { data: agentVersion } = await serviceClient
        .from("prompt_versions")
        .insert({
          workspace_id: workspaceId,
          prompt_id: agentPromptId,
          version: 1,
          state: "published",
          body,
          published_at: new Date().toISOString(),
          created_by: user.id,
        })
        .select("id")
        .single();
      const agentVersionId = (agentVersion as { id: string } | null)?.id;
      if (agentVersionId) {
        await serviceClient
          .from("prompts")
          .update({ active_version_id: agentVersionId })
          .eq("id", agentPromptId);
      }
    }

    await serviceClient.from("agents").insert({
      workspace_id: workspaceId,
      type,
      name: AGENT_NAMES[type],
      avatar_key: type,
      model: null,
      is_active: type === activeType,
      prompt_id: agentPromptId,
    });
  }

  // 9. Save YCloud integration (if credentials provided)
  let whatsappConnected = false;
  if (data.ycloudApiKey) {
    // Con la clave sola: buscar el número y crear el webhook en YCloud. Si algo
    // falla la clave queda guardada y se termina después desde Configuración.
    let phone = data.ycloudPhone ?? "";
    let signingSecret = data.ycloudSigningSecret ?? "";
    if (!signingSecret) {
      try {
        const picked = pickNumber(await listNumbers(data.ycloudApiKey), data.ycloudPhone);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || (await headers()).get("origin") || "";
        if ("phone" in picked && appUrl) {
          signingSecret = await ensureWebhook(data.ycloudApiKey, ycloudWebhookUrl(appUrl, workspaceId));
          phone = picked.phone;
          whatsappConnected = true;
        }
      } catch (err) {
        console.error("[completeOnboarding] ycloud connect:", err instanceof Error ? err.message : "unknown");
      }
    }
    const { error: intError } = await serviceClient
      .from("integrations")
      .insert({
        workspace_id: workspaceId,
        provider: "ycloud",
        enabled: true,
        credentials: await encryptCredentials(
          {
            ycloud_api_key: data.ycloudApiKey,
            webhook_signing_secret: signingSecret,
          },
          workspaceId,
          "ycloud",
        ),
        config: {
          phone_number: phone,
        },
        oauth_tokens: {},
      });

    if (intError) {
      console.error("[completeOnboarding] integration insert error:", intError);
      // Non-fatal — user can configure later in settings
    }
  }

  return { workspaceId, whatsappConnected };
}
