// F3-T2: Manual handoff — request or cancel a handoff for a conversation.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { applyTransition } from "@/features/inbox/services/decision-engine";
import { isReadOnlyMember, readJsonBody } from "@/lib/auth/workspace-access";

const bodySchema = z.object({
  action: z.enum(["request", "cancel"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // 2. Validate body
  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = bodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id: conversationId } = await params;
  const { action } = parsed.data;

  // applyTransition writes with the service role, so the access check is here:
  // RLS hides conversations from other workspaces.
  const { data: conv } = await supabase
    .from("conversations")
    .select("workspace_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  if (await isReadOnlyMember(supabase, conv.workspace_id, user.id)) {
    return NextResponse.json({ error: "Permisos insuficientes" }, { status: 403 });
  }

  try {
    // 3. Determine target state
    // 'request' → handoff_pending (from ai_active or human_active)
    // 'cancel'  → ai_active (from handoff_pending)
    const to = action === "request" ? "handoff_pending" : "ai_active";

    await applyTransition(conversationId, to, {
      userId: user.id,
      trigger: "manual",
    });

    // 4. Return updated state
    return NextResponse.json({ ok: true, state: to });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/conversations/[id]/handoff]:", message);

    // Surface transition validation errors as 422
    if (message.startsWith("Invalid transition:")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
