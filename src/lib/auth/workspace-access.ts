// Shared workspace authorization helpers.
//
// Centralizes the "is this authenticated user an active member of THIS workspace
// (with at least role X)?" check that several API routes were missing — the IDOR
// class of bugs found in the E2E audit (team/tools/integrations).
//
// Uses the RLS-respecting server client (anon key + the caller's cookie session),
// NOT the service-role client: a non-member's membership SELECT returns nothing
// and is correctly treated as "access denied". Mirrors the proven inline pattern
// in src/app/api/workspace/[id]/automations/route.ts, plus the is_active filter
// used in src/app/api/workspace/[id]/agents/route.ts.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceRole = "admin" | "manager" | "agent" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  agent: 1,
  manager: 2,
  admin: 3,
};

type MemberOk = { ok: true; userId: string; role: WorkspaceRole };
type MemberFail = { ok: false; response: NextResponse };

/**
 * Authenticates the caller and verifies they are an ACTIVE member of `workspaceId`.
 * Optionally enforces a minimum role (e.g. "manager" for mutations).
 *
 * Returns `{ ok: true, userId, role }` on success, or `{ ok: false, response }`
 * where `response` is the ready-to-return 401/403 NextResponse.
 *
 * Usage:
 *   const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
 *   if (!auth.ok) return auth.response;
 *   // ...proceed; safe to use the service-role client now.
 */
export async function requireWorkspaceMember(
  workspaceId: string,
  opts?: { minRole?: WorkspaceRole },
): Promise<MemberOk | MemberFail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acceso denegado" },
        { status: 403 },
      ),
    };
  }

  const role = member.role as WorkspaceRole;

  if (opts?.minRole && ROLE_RANK[role] < ROLE_RANK[opts.minRole]) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Permisos insuficientes" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id, role };
}

/**
 * True when the user is a viewer of this workspace. For conversation routes that
 * load the row through RLS (membership is already proven) and then write with
 * the service role, which would otherwise let a read-only member act.
 */
export async function isReadOnlyMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.role === "viewer";
}

type JsonOk<T> = { ok: true; body: T };
type JsonFail = { ok: false; response: NextResponse };

/**
 * Safely parses a JSON request body. Returns a 400 NextResponse on malformed JSON
 * instead of letting `req.json()` throw (which surfaces as a 500).
 *
 * Usage:
 *   const parsed = await readJsonBody(req);
 *   if (!parsed.ok) return parsed.response;
 *   const result = MySchema.safeParse(parsed.body);
 */
export async function readJsonBody<T = unknown>(
  req: Request,
): Promise<JsonOk<T> | JsonFail> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }
}
