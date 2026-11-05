// Automation engine: the Automatizaciones tab saves rules ("when X happens, do
// Y"); this is what runs them. The cron calls runAutomations() every minute.
//
// It reads the state of the database instead of hooking into the reply
// pipeline, so it never touches buffer.ts and a failure here can't break a
// reply. The price is up to a minute of delay.
//
// Rules for not doing damage:
//   - Idempotent: every firing has a fire_key and is claimed by inserting a
//     row in automation_runs (unique rule_id + fire_key) before acting.
//   - No history: a rule only reacts to what happened after it was last saved
//     or enabled, and at most LOOKBACK_MINUTES back.
//   - State changes go through applyTransition; a handoff made by an
//     automation never triggers another automation.
//   - Templates go through dispatchTemplate (opt-out is checked there) and,
//     for the 24h follow-up, only inside business hours.

import { createServiceClient as svc } from "@/lib/supabase/service";
import { safeError } from "@/lib/safe-error";
import { DEFAULT_TIMEZONE } from "@/features/inbox/services/business-info";
import type { ConversationState } from "@/features/inbox/services/state-machine";

/** How far back event triggers look (caps the burst after a cron outage). */
const LOOKBACK_MINUTES = 60;
/** window_closing fires when the 24h window has this long left. */
const WINDOW_CLOSING_HOURS = 2;
const DEFAULT_INACTIVITY_HOURS = 24;
const MAX_INACTIVITY_HOURS = 72;
/** Max actions per cron tick. */
const MAX_FIRINGS_PER_RUN = 20;
/** Follow-ups are only sent between these local hours. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 21;

export type TriggerType =
  | "first_message"
  | "inactivity_24h"
  | "window_closing"
  | "handoff_requested"
  | "lead_qualified"
  | "keyword_match";

export interface Rule {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  state: ConversationState;
  created_at: string;
  last_message_at: string | null;
  window_expires_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  created_at: string;
}

export interface HandoffEvent {
  id: string;
  conversation_id: string;
  trigger: string | null;
  created_at: string;
}

export interface QualifiedContact {
  contact_id: string;
  updated_at: string;
}

export interface Snapshot {
  conversations: ConversationRow[];
  /** Messages of those conversations, newest first. */
  messages: MessageRow[];
  handoffs: HandoffEvent[];
  qualified: QualifiedContact[];
}

export interface Firing {
  rule: Rule;
  conversationId: string;
  fireKey: string;
}

const ms = (iso: string) => new Date(iso).getTime();

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

/** Accent- and case-insensitive: does the text contain any keyword? */
export function matchesKeyword(text: string | null, keywords: unknown): boolean {
  if (!text || !Array.isArray(keywords)) return false;
  const t = normalize(text);
  return keywords.some(
    (k) => typeof k === "string" && k.trim() !== "" && t.includes(normalize(k.trim())),
  );
}

export function inactivityHours(rule: Rule): number {
  const h = Number(rule.trigger_config?.hours);
  if (!Number.isFinite(h) || h <= 0) return DEFAULT_INACTIVITY_HOURS;
  return Math.min(h, MAX_INACTIVITY_HOURS);
}

/** Local hour (0-23) in a time zone; falls back to the default zone. */
export function localHour(now: Date, timeZone: string): number {
  const fmt = (tz: string) =>
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz })
        .format(now),
    );
  try {
    return fmt(timeZone);
  } catch {
    return fmt(DEFAULT_TIMEZONE);
  }
}

export function withinSendingHours(now: Date, timeZone: string): boolean {
  const h = localHour(now, timeZone);
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR;
}

/**
 * Pure: which rules fire for which conversations right now. All trigger logic
 * lives here so it can be tested without a database.
 */
export function selectFirings(rules: Rule[], snap: Snapshot, now: Date): Firing[] {
  const t = now.getTime();
  const open = snap.conversations.filter((c) => c.state !== "closed");

  const byConv = new Map<string, MessageRow[]>();
  for (const m of snap.messages) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }
  for (const list of byConv.values()) list.sort((a, b) => ms(b.created_at) - ms(a.created_at));

  // Latest conversation of each contact, for contact-level triggers.
  const convOfContact = new Map<string, ConversationRow>();
  for (const c of open) {
    const prev = convOfContact.get(c.contact_id);
    if (!prev || ms(c.last_message_at ?? c.created_at) > ms(prev.last_message_at ?? prev.created_at)) {
      convOfContact.set(c.contact_id, c);
    }
  }

  const out: Firing[] = [];
  for (const rule of rules) {
    // Only what happened after the rule was saved/enabled, and not too far back.
    const since = Math.max(ms(rule.updated_at), t - LOOKBACK_MINUTES * 60_000);
    const ws = open.filter((c) => c.workspace_id === rule.workspace_id);
    const fire = (conversationId: string, fireKey: string) =>
      out.push({ rule, conversationId, fireKey });

    switch (rule.trigger_type) {
      case "first_message":
        for (const c of ws) {
          const wroteUs = (byConv.get(c.id) ?? []).some((m) => m.direction === "in");
          if (ms(c.created_at) >= since && wroteUs) fire(c.id, `first:${c.id}`);
        }
        break;

      case "keyword_match":
        for (const c of ws) {
          for (const m of byConv.get(c.id) ?? []) {
            if (m.direction !== "in" || ms(m.created_at) < since) continue;
            if (matchesKeyword(m.body, rule.trigger_config?.keywords)) fire(c.id, `kw:${m.id}`);
          }
        }
        break;

      case "handoff_requested":
        for (const e of snap.handoffs) {
          if (e.trigger === "automation" || ms(e.created_at) < since) continue;
          if (ws.some((c) => c.id === e.conversation_id)) fire(e.conversation_id, `handoff:${e.id}`);
        }
        break;

      case "lead_qualified":
        for (const q of snap.qualified) {
          const c = convOfContact.get(q.contact_id);
          if (c && c.workspace_id === rule.workspace_id && ms(q.updated_at) >= since) {
            fire(c.id, `qualified:${q.contact_id}`);
          }
        }
        break;

      case "inactivity_24h": {
        // We spoke last and the contact hasn't answered in N hours. Keyed on
        // the contact's last message: one follow-up per silence, never a chain.
        const hours = inactivityHours(rule);
        for (const c of ws) {
          const msgs = byConv.get(c.id) ?? [];
          const last = msgs[0];
          if (!last || last.direction !== "out") continue;
          const due = ms(last.created_at) + hours * 3_600_000;
          if (due > t || due < ms(rule.updated_at)) continue;
          const lastIn = msgs.find((m) => m.direction === "in");
          fire(c.id, `inactive:${lastIn?.id ?? c.id}`);
        }
        break;
      }

      case "window_closing":
        for (const c of ws) {
          if (!c.window_expires_at) continue;
          const left = ms(c.window_expires_at) - t;
          if (left > 0 && left <= WINDOW_CLOSING_HOURS * 3_600_000) {
            fire(c.id, `window:${c.id}:${c.window_expires_at}`);
          }
        }
        break;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// I/O
// ──────────────────────────────────────────────────────────────────────────────


type Db = ReturnType<typeof svc>;
type Outcome = { status: "done" | "skipped" | "failed"; detail?: string };

async function loadSnapshot(db: Db, rules: Rule[], now: Date): Promise<Snapshot> {
  const workspaceIds = [...new Set(rules.map((r) => r.workspace_id))];
  const maxHours = Math.max(DEFAULT_INACTIVITY_HOURS, ...rules.map(inactivityHours));
  // Inactivity needs the last message up to maxHours back (+ a day of margin
  // for follow-ups deferred to business hours); the rest needs far less.
  const msgCutoff = new Date(now.getTime() - (maxHours + 24) * 3_600_000).toISOString();
  const eventCutoff = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000).toISOString();

  const { data: convs } = await db
    .from("conversations")
    .select("id, workspace_id, contact_id, state, created_at, last_message_at, window_expires_at")
    .in("workspace_id", workspaceIds)
    .neq("state", "closed")
    .gte("last_message_at", msgCutoff)
    .order("last_message_at", { ascending: false })
    .limit(500);
  const conversations = (convs ?? []) as ConversationRow[];
  const convIds = conversations.map((c) => c.id);
  if (convIds.length === 0) return { conversations, messages: [], handoffs: [], qualified: [] };

  const [msgs, events, contacts] = await Promise.all([
    db
      .from("messages")
      .select("id, conversation_id, direction, body, created_at")
      .in("conversation_id", convIds)
      .gte("created_at", msgCutoff)
      .order("created_at", { ascending: false })
      .limit(3000),
    db
      .from("events")
      .select("id, conversation_id, payload, created_at")
      .in("workspace_id", workspaceIds)
      .eq("type", "state_change")
      .eq("payload->>to", "handoff_pending")
      .gte("created_at", eventCutoff)
      .limit(500),
    db
      .from("contacts")
      .select("id, updated_at")
      .in("workspace_id", workspaceIds)
      .eq("stage", "qualified")
      .gte("updated_at", eventCutoff)
      .limit(500),
  ]);

  return {
    conversations,
    messages: (msgs.data ?? []) as MessageRow[],
    handoffs: ((events.data ?? []) as Array<{
      id: string;
      conversation_id: string;
      payload: { trigger?: string } | null;
      created_at: string;
    }>).map((e) => ({
      id: e.id,
      conversation_id: e.conversation_id,
      trigger: e.payload?.trigger ?? null,
      created_at: e.created_at,
    })),
    qualified: ((contacts.data ?? []) as Array<{ id: string; updated_at: string }>).map((c) => ({
      contact_id: c.id,
      updated_at: c.updated_at,
    })),
  };
}

async function sendTemplateAction(f: Firing, contactId: string): Promise<Outcome> {
  const name = f.rule.action_config?.template_name;
  if (typeof name !== "string" || !name) return { status: "skipped", detail: "sin plantilla elegida" };
  const { sendApprovedTemplate } = await import("@/features/inbox/services/template-send");
  const r = await sendApprovedTemplate({
    workspaceId: f.rule.workspace_id,
    conversationId: f.conversationId,
    contactId,
    templateName: name,
  });
  return { status: r.status === "sent" ? "done" : r.status, detail: r.detail };
}

async function execute(db: Db, f: Firing, conv: ConversationRow): Promise<Outcome> {
  switch (f.rule.action_type) {
    case "send_template":
      return sendTemplateAction(f, conv.contact_id);

    case "add_tag": {
      const tag = f.rule.action_config?.tag;
      if (typeof tag !== "string" || !tag.trim()) return { status: "skipped", detail: "sin etiqueta" };
      const { data: contact } = await db.from("contacts").select("tags").eq("id", conv.contact_id).single();
      const tags = ((contact?.tags as string[] | null) ?? []);
      if (tags.includes(tag.trim())) return { status: "skipped", detail: "ya tenía la etiqueta" };
      const { error } = await db
        .from("contacts")
        .update({ tags: [...tags, tag.trim()] })
        .eq("id", conv.contact_id);
      return error ? { status: "failed", detail: error.message } : { status: "done", detail: `etiqueta ${tag.trim()}` };
    }

    case "close_conversation":
    case "handoff_human": {
      const to: ConversationState = f.rule.action_type === "close_conversation" ? "closed" : "handoff_pending";
      const { canTransition } = await import("@/features/inbox/services/state-machine");
      if (!canTransition(conv.state, to)) {
        return { status: "skipped", detail: `no se puede pasar de ${conv.state} a ${to}` };
      }
      const { applyTransition } = await import("@/features/inbox/services/decision-engine");
      await applyTransition(f.conversationId, to, { trigger: "automation" });
      return { status: "done", detail: to };
    }

    default:
      // assign_agent: the form doesn't let you pick an agent yet.
      return { status: "skipped", detail: "acción sin configurar" };
  }
}

async function timezonesOf(db: Db, workspaceIds: string[]): Promise<Map<string, string>> {
  const { data } = await db
    .from("business_info")
    .select("workspace_id, structured")
    .in("workspace_id", workspaceIds);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ workspace_id: string; structured: { timezone?: string } | null }>) {
    if (row.structured?.timezone) map.set(row.workspace_id, row.structured.timezone);
  }
  return map;
}

/**
 * Runs due automations. Returns how many actions were attempted. Never throws:
 * the cron that calls it also answers WhatsApp messages.
 */
export async function runAutomations(now = new Date()): Promise<number> {
  try {
    const db = svc();
    const { data: ruleRows, error } = await db
      .from("automation_rules")
      .select("id, workspace_id, name, trigger_type, trigger_config, action_type, action_config, updated_at")
      .eq("enabled", true);
    if (error || !ruleRows?.length) return 0;
    const rules = ruleRows as Rule[];

    const snap = await loadSnapshot(db, rules, now);
    const firings = selectFirings(rules, snap, now);
    if (firings.length === 0) return 0;

    const convById = new Map(snap.conversations.map((c) => [c.id, c]));
    const tz = await timezonesOf(db, [...new Set(firings.map((f) => f.rule.workspace_id))]);

    let attempted = 0;
    for (const f of firings) {
      if (attempted >= MAX_FIRINGS_PER_RUN) break;
      const conv = convById.get(f.conversationId);
      if (!conv) continue;

      // A follow-up at 3 a.m. does more harm than good: wait for business
      // hours. No run row is written, so a later tick picks it up.
      const zone = tz.get(f.rule.workspace_id) ?? DEFAULT_TIMEZONE;
      if (
        f.rule.trigger_type === "inactivity_24h" &&
        f.rule.action_type === "send_template" &&
        !withinSendingHours(now, zone)
      ) {
        continue;
      }

      // Claim the firing. If the row already exists, it ran (or is running).
      const { data: claimed, error: claimError } = await db
        .from("automation_runs")
        .upsert(
          {
            rule_id: f.rule.id,
            workspace_id: f.rule.workspace_id,
            conversation_id: f.conversationId,
            fire_key: f.fireKey,
          },
          { onConflict: "rule_id,fire_key", ignoreDuplicates: true },
        )
        .select("id");
      if (claimError) {
        // Most likely the migration isn't applied yet: do nothing.
        console.error("[automations] claim failed:", claimError.message);
        return attempted;
      }
      if (!claimed?.length) continue;

      attempted++;
      let outcome: Outcome;
      try {
        outcome = await execute(db, f, conv);
      } catch (err) {
        outcome = { status: "failed", detail: err instanceof Error ? err.message : String(err) };
      }

      await db
        .from("automation_runs")
        .update({ status: outcome.status, detail: outcome.detail?.slice(0, 300) ?? null })
        .eq("id", (claimed[0] as { id: string }).id);

      await db.from("events").insert({
        workspace_id: f.rule.workspace_id,
        conversation_id: f.conversationId,
        type: "automation_run",
        level: outcome.status === "failed" ? "error" : "info",
        payload: {
          rule_id: f.rule.id,
          rule_name: f.rule.name,
          trigger: f.rule.trigger_type,
          action: f.rule.action_type,
          status: outcome.status,
          ...(outcome.detail ? { detail: outcome.detail.slice(0, 300) } : {}),
        },
      });
    }
    return attempted;
  } catch (err) {
    console.error("[automations] run failed:", safeError(err));
    return 0;
  }
}
