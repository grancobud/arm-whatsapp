// Keeping promises: when the agent tells a customer "te escribo el jueves", it
// schedules that message with the schedule_followup tool, and the cron sends
// it when it's due. An ARM that forgets what it promised is just a chatbot.
//
// When it's due:
//   - WhatsApp's 24h window is open → the message goes out as is.
//   - The window is closed → free text can't be sent, so it becomes a task for
//     a person (status needs_human + an alert email) to answer with a template.
//   - A person took the conversation over → also needs_human: they decide.
//   - The conversation was closed or paused (opt-out) → cancelled.
// Messages only go out between 9 and 21 in the business's time zone.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE } from "@/features/inbox/services/business-info";
import { withinSendingHours } from "@/features/automations/engine";
import type { ConversationState } from "@/features/inbox/services/state-machine";

const MIN_LEAD_MINUTES = 10;
const MAX_DAYS_AHEAD = 60;
const MAX_PENDING_PER_CONVERSATION = 3;
const MAX_SENDS_PER_RUN = 20;

export interface FollowUpRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  due_at: string;
  message: string;
}

export interface FollowUpConversation {
  state: ConversationState;
  window_expires_at: string | null;
}

export type FollowUpDecision =
  | { action: "wait" }
  | { action: "send" }
  | { action: "needs_human"; detail: string }
  | { action: "cancel"; detail: string };

/** Pure: what to do with a follow-up right now. */
export function decideFollowUp(
  fu: FollowUpRow,
  conv: FollowUpConversation | null,
  now: Date,
  timeZone: string,
): FollowUpDecision {
  if (new Date(fu.due_at).getTime() > now.getTime()) return { action: "wait" };
  if (!conv) return { action: "cancel", detail: "la conversación ya no existe" };
  if (conv.state === "closed" || conv.state === "paused") {
    return { action: "cancel", detail: `conversación ${conv.state === "closed" ? "cerrada" : "en pausa"}` };
  }
  if (!withinSendingHours(now, timeZone)) return { action: "wait" };
  if (conv.state === "human_active" || conv.state === "handoff_pending") {
    return { action: "needs_human", detail: "la conversación la lleva una persona" };
  }
  const windowOpen =
    conv.window_expires_at === null || new Date(conv.window_expires_at).getTime() > now.getTime();
  if (!windowOpen) {
    return { action: "needs_human", detail: "pasaron más de 24 h: hay que escribirle con una plantilla" };
  }
  return { action: "send" };
}

/** Pure: validates the time the agent asked for. Returns an error in Spanish. */
export function validateDueAt(dueAt: string, now: Date): { date: Date } | { error: string } {
  // Require an explicit offset or Z: a bare "2026-11-06T10:00" would be read in
  // the server's zone (UTC on Vercel), three hours off for Argentina.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(dueAt.trim())) {
    return { error: "Pasá la fecha en ISO con el offset de la zona del negocio (ej: 2026-11-06T10:00:00-03:00)." };
  }
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return { error: "Fecha inválida." };
  const ms = date.getTime() - now.getTime();
  if (ms < MIN_LEAD_MINUTES * 60_000) return { error: "La fecha tiene que ser al menos 10 minutos en el futuro." };
  if (ms > MAX_DAYS_AHEAD * 86_400_000) return { error: "Como mucho se puede agendar a 60 días." };
  return { date };
}

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function scheduleFollowUp(params: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  dueAt: string;
  message: string;
  reason?: string;
  now?: Date;
}): Promise<{ ok: true; dueAt: string } | { ok: false; error: string }> {
  const checked = validateDueAt(params.dueAt, params.now ?? new Date());
  if ("error" in checked) return { ok: false, error: checked.error };

  const supabase = svc();
  const { count } = await supabase
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_PER_CONVERSATION) {
    return { ok: false, error: "Ya hay 3 seguimientos pendientes con este cliente." };
  }

  const { error } = await supabase.from("follow_ups").insert({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    contact_id: params.contactId,
    due_at: checked.date.toISOString(),
    message: params.message.trim(),
    reason: params.reason?.trim() || null,
  });
  if (error) return { ok: false, error: "No se pudo agendar el seguimiento." };
  return { ok: true, dueAt: checked.date.toISOString() };
}

/**
 * Sends due follow-ups. Returns how many were handled. Never throws: the cron
 * that calls it also answers WhatsApp messages.
 */
export async function runFollowUps(now = new Date()): Promise<number> {
  try {
    const supabase = svc();
    const { data: due, error } = await supabase
      .from("follow_ups")
      .select("id, workspace_id, conversation_id, due_at, message")
      .eq("status", "pending")
      .lte("due_at", now.toISOString())
      .order("due_at", { ascending: true })
      .limit(MAX_SENDS_PER_RUN);
    if (error || !due?.length) return 0;
    const rows = due as FollowUpRow[];

    const [{ data: convs }, { data: infos }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, state, window_expires_at")
        .in("id", [...new Set(rows.map((r) => r.conversation_id))]),
      supabase
        .from("business_info")
        .select("workspace_id, structured")
        .in("workspace_id", [...new Set(rows.map((r) => r.workspace_id))]),
    ]);
    const convById = new Map(
      ((convs ?? []) as Array<FollowUpConversation & { id: string }>).map((c) => [c.id, c]),
    );
    const tzOf = new Map(
      ((infos ?? []) as Array<{ workspace_id: string; structured: { timezone?: string } | null }>).map(
        (i) => [i.workspace_id, i.structured?.timezone ?? DEFAULT_TIMEZONE],
      ),
    );

    let handled = 0;
    for (const fu of rows) {
      const decision = decideFollowUp(
        fu,
        convById.get(fu.conversation_id) ?? null,
        now,
        tzOf.get(fu.workspace_id) ?? DEFAULT_TIMEZONE,
      );
      if (decision.action === "wait") continue;

      // Claim it: only one cron tick may handle each follow-up.
      const { data: claimed } = await supabase
        .from("follow_ups")
        .update({ status: "sending" })
        .eq("id", fu.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) continue;
      handled++;

      let status: "sent" | "needs_human" | "cancelled" | "failed";
      let detail: string | null = null;
      if (decision.action === "send") {
        const { dispatchText } = await import("@/features/inbox/services/dispatch");
        try {
          const r = await dispatchText({
            workspaceId: fu.workspace_id,
            conversationId: fu.conversation_id,
            body: fu.message,
            meta: { follow_up_id: fu.id },
          });
          if (r.ok) status = "sent";
          else if (r.error?.startsWith("OPT_OUT")) [status, detail] = ["cancelled", "el contacto pidió la baja"];
          else if (r.error === "WINDOW_EXPIRED") [status, detail] = ["needs_human", "pasaron más de 24 h: hay que escribirle con una plantilla"];
          else [status, detail] = ["failed", r.error ?? "error"];
        } catch (err) {
          [status, detail] = ["failed", err instanceof Error ? err.message : String(err)];
        }
      } else {
        status = decision.action === "cancel" ? "cancelled" : "needs_human";
        detail = decision.detail;
      }

      await supabase
        .from("follow_ups")
        .update({ status, detail: detail?.slice(0, 300) ?? null, done_at: now.toISOString() })
        .eq("id", fu.id);

      if (status === "needs_human" || status === "failed") {
        // needs_human is a warn the alert email picks up: someone must write.
        await supabase.from("events").insert({
          workspace_id: fu.workspace_id,
          conversation_id: fu.conversation_id,
          type: status === "failed" ? "follow_up_failed" : "follow_up_due",
          level: status === "failed" ? "error" : "warn",
          payload: { follow_up_id: fu.id, reason: detail },
        });
      }
    }
    return handled;
  } catch (err) {
    console.error("[follow-ups] run failed:", err);
    return 0;
  }
}
