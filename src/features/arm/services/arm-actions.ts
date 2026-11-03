"use server";

/**
 * arm-actions.ts — Server actions for the ARM: contact memory, the review queue
 * (agent proposals + campaigns awaiting approval) and campaign creation.
 *
 * Every action re-checks membership on the row's own workspace_id (IDOR class
 * from the E2E audit) before touching anything with the service-role client.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { registry } from "@/features/tools";
import { isMcpToolName } from "@/features/tools/mcp/mcp-tools";
import { resolveMcpTool } from "@/features/tools/mcp/mcp-servers";
import { createCampaign, resolveSegment } from "./campaigns";
import type { ClaimRow } from "../types";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

// ──────────────────────────────────────────────────────────────────────────────
// Contact memory
// ──────────────────────────────────────────────────────────────────────────────

/** Claims of a contact, read through RLS (caller must be a member). */
export async function listContactClaims(
  contactId: string,
): Promise<Result<ClaimRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_claims")
    .select("*")
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: "No se pudo leer la memoria" };
  return { ok: true, data: (data ?? []) as ClaimRow[] };
}

/** Marks a claim as wrong. RLS limits it to operators of its workspace. */
export async function retractClaim(claimId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contact_claims")
    .update({ status: "retracted" })
    .eq("id", claimId);
  if (error) return { ok: false, error: "No se pudo descartar el dato" };
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Review queue: agent proposals
// ──────────────────────────────────────────────────────────────────────────────

export async function decideProposal(
  proposalId: string,
  approve: boolean,
): Promise<Result> {
  const supabase = svc();
  const { data: proposal } = await supabase
    .from("agent_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) return { ok: false, error: "Propuesta no encontrada" };

  const auth = await requireWorkspaceMember(proposal.workspace_id as string, {
    minRole: "manager",
  });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para decidir" };

  // Claim the row: only one decision can win a pending proposal.
  const { data: claimed } = await supabase
    .from("agent_proposals")
    .update({
      status: approve ? "executed" : "rejected",
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "La propuesta ya fue decidida" };

  if (approve) {
    // Same write path as the agent: zod validation, timeout and logging live
    // in the registry; approvedProposalId lets the sensitive tool run.
    const ctx = {
      workspaceId: proposal.workspace_id as string,
      conversationId: proposal.conversation_id as string,
      contactId: proposal.contact_id as string,
    };
    const toolName = proposal.tool_name as string;
    // A workspace's MCP tool is rebuilt from THAT workspace's server; the
    // shared registry only holds the built-in tools.
    let result;
    if (isMcpToolName(toolName)) {
      const mcpTool = await resolveMcpTool(ctx.workspaceId, toolName).catch(() => null);
      result = mcpTool
        ? await registry.runTool(mcpTool, proposal.args, ctx, { approvedProposalId: proposalId })
        : { ok: false, output: null, error: "El sistema externo ya no ofrece esta acción o no responde" };
    } else {
      result = await registry.run(toolName, proposal.args, ctx, { approvedProposalId: proposalId });
    }
    await supabase
      .from("agent_proposals")
      .update({
        status: result.ok ? "executed" : "failed",
        result: { ok: result.ok, output: result.output, error: result.error },
      })
      .eq("id", proposalId);
    if (!result.ok) {
      revalidatePath("/revision");
      return { ok: false, error: result.error ?? "La acción falló" };
    }
  }

  revalidatePath("/revision");
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Campaigns
// ──────────────────────────────────────────────────────────────────────────────

const SegmentSchema = z.object({
  stages: z
    .array(z.enum(["new", "engaged", "qualified", "customer", "lost"]))
    .optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  inactive_days: z.number().int().min(0).max(3650).optional(),
});

const CampaignSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1, "Poné un nombre").max(120),
  segment: SegmentSchema,
  templateId: z.string().uuid("Elegí una plantilla"),
  variables: z.array(z.string().max(200)).max(10),
});

export async function previewSegment(
  workspaceId: string,
  segment: unknown,
): Promise<Result<{ count: number; sample: string[] }>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso" };
  const parsed = SegmentSchema.safeParse(segment);
  if (!parsed.success) return { ok: false, error: "Segmento inválido" };

  const contacts = await resolveSegment(workspaceId, parsed.data);
  return {
    ok: true,
    data: {
      count: contacts.length,
      sample: contacts.slice(0, 5).map((c) => c.name ?? c.phone),
    },
  };
}

export async function createCampaignAction(
  input: unknown,
): Promise<Result<{ id: string; recipientCount: number }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }
  const { workspaceId, name, segment, templateId, variables } = parsed.data;

  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso" };

  // The template must be this workspace's and approved by Meta.
  const { data: template } = await svc()
    .from("templates")
    .select("name, language, status")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!template || template.status !== "approved") {
    return { ok: false, error: "La plantilla no está aprobada por Meta" };
  }

  try {
    const created = await createCampaign({
      workspaceId,
      userId: auth.userId,
      name,
      segment,
      templateName: template.name as string,
      templateLanguage: (template.language as string) ?? "es",
      variables,
    });
    revalidatePath("/campanas");
    revalidatePath("/revision");
    return { ok: true, data: created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo crear",
    };
  }
}

/** Approving moves the campaign to "sending"; the cron drains it in batches. */
export async function decideCampaign(
  campaignId: string,
  approve: boolean,
): Promise<Result> {
  const supabase = svc();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campaña no encontrada" };

  const auth = await requireWorkspaceMember(campaign.workspace_id as string, {
    minRole: "manager",
  });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para decidir" };

  const { data: updated } = await supabase
    .from("campaigns")
    .update({
      status: approve ? "sending" : "rejected",
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "La campaña ya fue decidida" };

  revalidatePath("/revision");
  revalidatePath("/campanas");
  return { ok: true, data: null };
}
