import { createServiceClient as svc } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspaceMember,
  readJsonBody,
} from "@/lib/auth/workspace-access";
import { provisionWorkspaceUser } from "@/lib/auth/provision-user";
import { teamChangeError, type TeamRole } from "@/lib/auth/team-rules";

/** Lo que hace falta saber de la persona a cambiar y del negocio para aplicar team-rules. */
async function teamState(db: ReturnType<typeof svc>, workspaceId: string, userId: string) {
  const [{ data: target }, { count }] = await Promise.all([
    db.from("memberships").select("role, is_active").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
    db
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("role", "admin")
      .eq("is_active", true),
  ]);
  return {
    targetRole: (target?.role as TeamRole | undefined) ?? null,
    targetIsActive: (target?.is_active as boolean | undefined) ?? undefined,
    activeAdmins: count ?? 0,
  };
}

const forbidden = (error: string) => NextResponse.json({ error }, { status: 403 });

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

const RoleEnum = z.enum(["admin", "manager", "agent", "viewer"]);

const InviteSchema = z.object({
  email: z.string().email(),
  role: RoleEnum,
  password: z.string().min(8).max(72).optional().or(z.literal("")),
});

const PatchSchema = z.object({
  userId: z.string().uuid(),
  role: RoleEnum.optional(),
  is_active: z.boolean().optional(),
});

const DeleteSchema = z.object({
  userId: z.string().uuid(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Auth + workspace guard (shared across handlers)
// ──────────────────────────────────────────────────────────────────────────────


// ──────────────────────────────────────────────────────────────────────────────
// GET /api/workspace/[id]/team
// Returns all memberships with user email, role, is_active, created_at
// ──────────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  const db = svc();

  const { data, error } = await db
    .from("memberships")
    .select(
      `
      id,
      user_id,
      role,
      is_active,
      created_at,
      users ( full_name, email )
    `,
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten nested users join into a flat member shape
  const members = (
    (data ?? []) as unknown as Array<{
      id: string;
      user_id: string;
      role: string;
      is_active: boolean;
      created_at: string;
      users: { full_name: string | null; email: string } | null;
    }>
  ).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    email: row.users?.email ?? "",
    full_name: row.users?.full_name ?? null,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
  }));

  return NextResponse.json({ members });
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/workspace/[id]/team
// Invite a user by email. Creates auth user (invite) + membership.
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = InviteSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { email, role, password } = parsed.data;
  const db = svc();

  // Antes de crear la cuenta: nadie da un rol igual o mayor al suyo, salvo un admin.
  const roleDenied = teamChangeError({ actorRole: auth.role, targetRole: null, newRole: role, activeAdmins: 1 });
  if (roleDenied) return forbidden(roleDenied);

  // Provision the account directly — no invite email / SMTP. The agency shares
  // the returned credentials and the user logs in directly.
  let provisioned;
  try {
    provisioned = await provisionWorkspaceUser(db, email, {
      password: password || undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "No se pudo crear el usuario",
      },
      { status: 400 },
    );
  }

  // Si ya era del equipo, volver a invitarla es cambiarle el rol.
  const existingDenied = teamChangeError({
    actorRole: auth.role,
    newRole: role,
    ...(await teamState(db, workspaceId, provisioned.userId)),
  });
  if (existingDenied) return forbidden(existingDenied);

  // Create membership (upsert — re-invite idempotent)
  const { error: memberError } = await db.from("memberships").upsert(
    {
      workspace_id: workspaceId,
      user_id: provisioned.userId,
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    credentials: provisioned.password
      ? { email, password: provisioned.password }
      : null,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/workspace/[id]/team
// Update role and/or is_active for a membership
// ──────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = PatchSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { userId, role, is_active } = parsed.data;
  const db = svc();

  const denied = teamChangeError({
    actorRole: auth.role,
    newRole: role,
    deactivates: is_active === false,
    ...(await teamState(db, workspaceId, userId)),
  });
  if (denied) return forbidden(denied);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (role !== undefined) updates.role = role;
  if (is_active !== undefined) updates.is_active = is_active;

  const { error } = await db
    .from("memberships")
    .update(updates)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/workspace/[id]/team
// Soft-deactivate a member (set is_active = false, never hard-delete)
// ──────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = DeleteSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { userId } = parsed.data;
  const db = svc();

  const denied = teamChangeError({
    actorRole: auth.role,
    deactivates: true,
    ...(await teamState(db, workspaceId, userId)),
  });
  if (denied) return forbidden(denied);

  const { error } = await db
    .from("memberships")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
