// F7: Business info API — GET/PUT for workspace business context.

import { safeError } from "@/lib/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getBusinessInfo,
  upsertBusinessInfo,
} from "@/features/inbox/services/business-info";

const UpdateSchema = z.object({
  structured: z.record(z.string(), z.unknown()).optional(),
  free_text: z.string().max(10_000).optional(),
});

// ── GET /api/workspace/[id]/business-info ─────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Verify user belongs to this workspace
  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const info = await getBusinessInfo(workspaceId);

  return NextResponse.json({
    data: info ?? { structured: {}, free_text: null },
  });
}

// ── PUT /api/workspace/[id]/business-info ─────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Verify admin or manager role
  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  // Validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (
    parsed.data.structured === undefined &&
    parsed.data.free_text === undefined
  ) {
    return NextResponse.json(
      { error: "Se requiere al menos structured o free_text" },
      { status: 400 },
    );
  }

  try {
    await upsertBusinessInfo(workspaceId, parsed.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/workspace/[id]/business-info]:", safeError(err));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
