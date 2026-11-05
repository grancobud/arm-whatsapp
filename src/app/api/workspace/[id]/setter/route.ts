// G5: Setter mode API — CRUD for setter_configs table.

import { createServiceClient as svc } from "@/lib/supabase/service";
import { safeError } from "@/lib/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Schemas ───────────────────────────────────────────────────────────────────

const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  type: z.enum(["open", "yes_no", "multiple"]),
  weight: z.number().min(0).max(10),
});

const KnockoutRuleSchema = z.object({
  question_id: z.string().min(1),
  condition: z.string().min(1).max(200),
  action: z.enum(["disqualify", "continue", "handoff"]),
});

const ScoringSchema = z.object({
  threshold: z.number().min(0).max(100),
  max_score: z.number().min(1).max(100),
});

const PostActionSchema = z.object({
  type: z.enum([
    "send_template",
    "create_hl_opportunity",
    "handoff",
    "add_tag",
  ]),
  tag: z.string().max(100).optional(),
  template_name: z.string().max(200).optional(),
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(false),
  questions: z.array(QuestionSchema).default([]),
  knockout_rules: z.array(KnockoutRuleSchema).default([]),
  scoring: ScoringSchema.default({ threshold: 50, max_score: 100 }),
  post_action: PostActionSchema.default({ type: "handoff" }),
});

const PatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  questions: z.array(QuestionSchema).optional(),
  knockout_rules: z.array(KnockoutRuleSchema).optional(),
  scoring: ScoringSchema.optional(),
  post_action: PostActionSchema.optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────


async function resolveWorkspaceMember(
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

async function authGuard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  requireManagerOrAbove = false,
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, member: null, error: "No autorizado", status: 401 };
  }

  const member = await resolveWorkspaceMember(supabase, workspaceId, user.id);
  if (!member) {
    return { user, member: null, error: "Acceso denegado", status: 403 };
  }

  if (
    requireManagerOrAbove &&
    !["admin", "manager"].includes(member.role as string)
  ) {
    return {
      user,
      member,
      error: "Se requiere rol admin o manager",
      status: 403,
    };
  }

  return { user, member, error: null, status: 200 };
}

// ── GET /api/workspace/[id]/setter ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const supabase = await createClient();

  const guard = await authGuard(supabase, workspaceId);
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const db = svc();
  const { data, error } = await db
    .from("setter_configs")
    .select(
      "id, name, enabled, questions, knockout_rules, scoring, post_action",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/workspace/[id]/setter]:", safeError(error));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? null });
}

// ── POST /api/workspace/[id]/setter ──────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const supabase = await createClient();

  const guard = await authGuard(supabase, workspaceId, true);
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
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
    .from("setter_configs")
    .insert({
      workspace_id: workspaceId,
      ...parsed.data,
    })
    .select(
      "id, name, enabled, questions, knockout_rules, scoring, post_action",
    )
    .single();

  if (error || !data) {
    console.error("[POST /api/workspace/[id]/setter]:", safeError(error));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}

// ── PATCH /api/workspace/[id]/setter ─────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const supabase = await createClient();

  const guard = await authGuard(supabase, workspaceId, true);
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, ...updates } = parsed.data;

  const db = svc();

  // Verify the config belongs to this workspace before updating
  const { data: existing } = await db
    .from("setter_configs")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Configuración no encontrada" },
      { status: 404 },
    );
  }

  const { data, error } = await db
    .from("setter_configs")
    .update(updates)
    .eq("id", id)
    .select(
      "id, name, enabled, questions, knockout_rules, scoring, post_action",
    )
    .single();

  if (error || !data) {
    console.error("[PATCH /api/workspace/[id]/setter]:", safeError(error));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}
