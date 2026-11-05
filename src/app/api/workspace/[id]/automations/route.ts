// G3: Automation Rules API — list, create, update, delete workspace automation rules.

import { safeError } from "@/lib/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSbClient } from "@supabase/supabase-js";

// ── Service-role client ───────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Shared auth helper ────────────────────────────────────────────────────────

async function resolveMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
) {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

// ── Validation schemas ────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  "first_message",
  "inactivity_24h",
  "window_closing",
  "handoff_requested",
  "lead_qualified",
  "keyword_match",
] as const;

const ACTION_TYPES = [
  "send_template",
  "assign_agent",
  "add_tag",
  "close_conversation",
  "handoff_human",
] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger_type: z.enum(TRIGGER_TYPES),
  trigger_config: z.record(z.string(), z.unknown()).default({}),
  action_type: z.enum(ACTION_TYPES),
  action_config: z.record(z.string(), z.unknown()).default({}),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
  action_type: z.enum(ACTION_TYPES).optional(),
  action_config: z.record(z.string(), z.unknown()).optional(),
});

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

// ── GET /api/workspace/[id]/automations ───────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const db = svc();
  const { data, error } = await db
    .from("automation_rules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[GET /api/workspace/[id]/automations]:", safeError(error));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}

// ── POST /api/workspace/[id]/automations ──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = svc();
  const { data, error } = await db
    .from("automation_rules")
    .insert({ workspace_id: workspaceId, ...parsed.data })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/workspace/[id]/automations]:", safeError(error));
    return NextResponse.json(
      { error: "Error al crear la automatización" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}

// ── PATCH /api/workspace/[id]/automations ─────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

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

  const { id, ...fields } = parsed.data;

  const db = svc();
  const { data, error } = await db
    .from("automation_rules")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) {
    console.error("[PATCH /api/workspace/[id]/automations]:", safeError(error));
    return NextResponse.json(
      { error: "Error al actualizar la automatización" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}

// ── DELETE /api/workspace/[id]/automations ────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = svc();
  const { error } = await db
    .from("automation_rules")
    .delete()
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[DELETE /api/workspace/[id]/automations]:", safeError(error));
    return NextResponse.json(
      { error: "Error al eliminar la automatización" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
