// GET/PATCH /api/workspace/:id/privacy → plazo de conservación de los datos.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { readRetentionMonths, RETENTION_OPTIONS } from "@/features/privacy/privacy-rules";

type RouteParams = { params: Promise<{ id: string }> };

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PatchSchema = z.object({
  retentionMonths: z
    .number()
    .refine((v) => RETENTION_OPTIONS.includes(v as (typeof RETENTION_OPTIONS)[number])),
});

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireWorkspaceMember(id, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const { data, error } = await svc().from("workspaces").select("settings").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo leer el plazo" }, { status: 500 });
  return NextResponse.json({ retentionMonths: readRetentionMonths(data?.settings) });
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireWorkspaceMember(id, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Plazo inválido" }, { status: 400 });

  const db = svc();
  const { data, error } = await db.from("workspaces").select("settings").eq("id", id).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "No se pudo leer el cliente" }, { status: 500 });

  const settings = { ...(data.settings as Record<string, unknown> | null), retention_months: parsed.data.retentionMonths };
  const { error: updateError } = await db.from("workspaces").update({ settings }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "No se pudo guardar el plazo" }, { status: 500 });

  await db.from("events").insert({
    workspace_id: id,
    type: "retention_changed",
    level: "info",
    payload: { by: auth.userId, months: parsed.data.retentionMonths },
  });
  return NextResponse.json({ retentionMonths: parsed.data.retentionMonths });
}
