// GET /api/contacts/:id/export → todo lo que se sabe de una persona, para
// responder un pedido de acceso (Ley 25.326, art. 14). Managers y admins.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: contactId } = await params;

  // RLS: si no es de un cliente del usuario, no aparece.
  const supabase = await createClient();
  const { data: found } = await supabase
    .from("contacts")
    .select("id, workspace_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!found) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  const auth = await requireWorkspaceMember(found.workspace_id, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const db = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const scoped = (table: string, columns: string) =>
    db.from(table).select(columns).eq("workspace_id", found.workspace_id);

  try {
    const [contact, conversations, claims, appointments, followUps, proposals, campaigns, changes] =
      await Promise.all([
        scoped(
          "contacts",
          "id, phone, name, email, source, stage, tags, custom_fields, opt_in, opt_in_at, opt_in_source, opt_out_at, marketing_opt_in, marketing_opt_in_at, marketing_opt_in_source, privacy_notice_sent_at, created_at, updated_at",
        ).eq("id", contactId).maybeSingle(),
        scoped("conversations", "id, channel, state, summary, last_message_at, created_at").eq("contact_id", contactId),
        scoped("contact_claims", "id, kind, text, quote, author, status, created_at").eq("contact_id", contactId),
        scoped("appointments", "id, scheduled_at, status, meta, created_at").eq("contact_id", contactId),
        scoped("follow_ups", "id, due_at, message, reason, status, created_at, done_at").eq("contact_id", contactId),
        scoped("agent_proposals", "id, tool_name, args, status, result, decided_at, created_at").eq("contact_id", contactId),
        scoped("campaign_recipients", "id, campaign_id, status, sent_at, created_at").eq("contact_id", contactId),
        scoped("contact_changes", "id, field, old_value, new_value, quote, reverted_at, created_at").eq("contact_id", contactId),
      ]);

    const results = [contact, conversations, claims, appointments, followUps, proposals, campaigns, changes];
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);

    const conversationRows = (conversations.data ?? []) as unknown as { id: string }[];
    const ids = conversationRows.map((c) => c.id);
    const { data: messages, error: messagesError } = ids.length
      ? await scoped("messages", "id, conversation_id, direction, type, body, status, meta, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (messagesError) throw new Error(messagesError.message);

    await db.from("events").insert({
      workspace_id: found.workspace_id,
      type: "contact_exported",
      level: "info",
      payload: { by: auth.userId, contact_id: contactId },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(
      JSON.stringify(
        {
          format: "arm-contact-export",
          version: 1,
          exported_at: new Date().toISOString(),
          contact: contact.data,
          conversations: conversations.data,
          messages,
          claims: claims.data,
          appointments: appointments.data,
          follow_ups: followUps.data,
          proposals: proposals.data,
          campaigns: campaigns.data,
          contact_changes: changes.data,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="contacto-${stamp}.json"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    console.error("[contact export] failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "No se pudo generar la exportación" }, { status: 500 });
  }
}
