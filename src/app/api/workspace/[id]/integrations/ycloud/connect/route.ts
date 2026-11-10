import { NextRequest, NextResponse } from "next/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { decryptCredentials, encryptCredentials } from "@/shared/lib/integration-secrets";
import {
  connectErrorMessage,
  ensureWebhook,
  listNumbers,
  pickNumber,
  ycloudWebhookUrl,
} from "@/features/inbox/services/ycloud-connect";

const Body = z.object({
  apiKey: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
});

// Alta con una sola clave: con la API key encuentra el número, crea el webhook
// en YCloud y guarda la clave de firma. Nada de eso vuelve al navegador.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = Body.safeParse(parsedBody.body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Datos inválidos" }, { status: 400 });

  const svc = svcClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: existing } = await svc
    .from("integrations")
    .select("credentials, config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "ycloud")
    .maybeSingle();

  const stored = await decryptCredentials(
    (existing?.credentials as Record<string, unknown> | null) ?? null,
    workspaceId,
    "ycloud",
  );
  // El formulario devuelve la clave guardada como "••••••": eso no es una clave nueva.
  const typed = parsed.data.apiKey && !parsed.data.apiKey.includes("•") ? parsed.data.apiKey : "";
  const apiKey = typed || (typeof stored.ycloud_api_key === "string" ? stored.ycloud_api_key : "");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Falta la clave de YCloud." });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  try {
    const numbers = await listNumbers(apiKey);
    const picked = pickNumber(numbers, parsed.data.phone);
    if ("error" in picked) return NextResponse.json({ ok: false, error: picked.error });
    if ("choose" in picked) return NextResponse.json({ ok: false, numbers: picked.choose });

    const secret = await ensureWebhook(apiKey, ycloudWebhookUrl(appUrl, workspaceId));

    const { error } = await svc.from("integrations").upsert(
      {
        workspace_id: workspaceId,
        provider: "ycloud",
        enabled: true,
        credentials: await encryptCredentials(
          { ...stored, ycloud_api_key: apiKey, webhook_signing_secret: secret },
          workspaceId,
          "ycloud",
        ),
        config: { ...((existing?.config as object) ?? {}), phone_number: picked.phone },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider" },
    );
    if (error) return NextResponse.json({ ok: false, error: "No se pudo guardar la conexión." }, { status: 500 });

    return NextResponse.json({ ok: true, phone: picked.phone });
  } catch (err) {
    console.error("[ycloud/connect]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: connectErrorMessage(err) });
  }
}
