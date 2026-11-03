// Relationship score: how alive the relationship with each customer is, and
// who is cooling off. A CRM stores the file; an ARM tells you "write to these
// five today, and why". Computed on read from what's already in the database
// (messages, stage, consent, memory, promises): nothing to keep in sync.
//
// scoreRelationship is pure and tested (evals/relacion). The weights are
// simple on purpose so the reason shown to the owner matches the number.

import { createClient as createSbClient } from "@supabase/supabase-js";

const DAY = 86_400_000;
/** Cooling off: wrote before, silent for between these many days. */
const COOLING_FROM_DAYS = 7;
const COLD_AFTER_DAYS = 45;
const HISTORY_DAYS = 90;
const SUGGEST_LIMIT = 8;

export type RelationshipStatus = "activa" | "enfriandose" | "fria" | "perdida" | "baja" | "nueva";

export interface RelationshipInput {
  optIn: boolean;
  stage: string;
  /** Timestamps (ms) of the contact's messages in the last HISTORY_DAYS. */
  inbound: number[];
  /** Timestamps (ms) of our messages in the last HISTORY_DAYS. */
  outbound: number[];
  /** Active memory items of kind risk or objection. */
  openRisks: number;
  hasPendingPromise: boolean;
  /** A person is handling it (or it's waiting for one). */
  withPerson: boolean;
}

export interface Relationship {
  score: number;
  status: RelationshipStatus;
  daysSilent: number | null;
  suggestWrite: boolean;
  reason: string;
}

const STAGE_POINTS: Record<string, number> = {
  customer: 15,
  qualified: 12,
  engaged: 6,
  new: 2,
  lost: 0,
};

const STAGE_WORDS: Record<string, string> = {
  customer: "Es cliente",
  qualified: "Está calificado",
  engaged: "Estaba interesado",
};

function recencyPoints(days: number): number {
  if (days <= 3) return 40;
  if (days <= 7) return 32;
  if (days <= 14) return 22;
  if (days <= 30) return 12;
  if (days <= 60) return 5;
  return 0;
}

export function scoreRelationship(input: RelationshipInput, now: number): Relationship {
  const lastIn = input.inbound.length ? Math.max(...input.inbound) : null;
  const daysSilent = lastIn === null ? null : Math.floor((now - lastIn) / DAY);

  if (!input.optIn) {
    return { score: 0, status: "baja", daysSilent, suggestWrite: false, reason: "Pidió no recibir mensajes" };
  }

  const inbound30 = input.inbound.filter((t) => now - t <= 30 * DAY).length;
  // Reciprocity: of our messages, how many got an answer within 48 h.
  const ours = input.outbound.filter((t) => now - t <= 30 * DAY);
  const answered = ours.filter((t) => input.inbound.some((i) => i > t && i - t <= 2 * DAY)).length;
  const reciprocity = ours.length ? answered / ours.length : 0;

  const raw =
    (daysSilent === null ? 0 : recencyPoints(daysSilent)) +
    Math.min(25, inbound30 * 5) +
    Math.round(reciprocity * 15) +
    (STAGE_POINTS[input.stage] ?? 0) -
    Math.min(15, input.openRisks * 5);
  const score = Math.max(0, Math.min(100, raw));

  let status: RelationshipStatus;
  if (input.stage === "lost") status = "perdida";
  else if (daysSilent === null) status = "nueva";
  else if (daysSilent < COOLING_FROM_DAYS) status = "activa";
  else if (daysSilent <= COLD_AFTER_DAYS) status = "enfriandose";
  else status = "fria";

  // Only worth a message if there was a real relationship to cool off from.
  const hadRelationship =
    input.stage === "customer" || input.stage === "qualified" || input.stage === "engaged" ||
    input.inbound.length >= 3;
  const suggestWrite =
    status === "enfriandose" && hadRelationship && !input.hasPendingPromise && !input.withPerson;

  let reason: string;
  if (status === "enfriandose") {
    const who = STAGE_WORDS[input.stage] ?? (input.inbound.length >= 3 ? "Escribía seguido" : "Habló con el agente");
    reason = `${who} y hace ${daysSilent} días que no escribe`;
    if (input.openRisks) reason += ` · tiene ${input.openRisks === 1 ? "una objeción o riesgo" : `${input.openRisks} objeciones o riesgos`} sin resolver`;
    if (input.hasPendingPromise) reason += " · ya hay una promesa agendada";
  } else if (status === "activa") reason = daysSilent === 0 ? "Escribió hoy" : `Escribió hace ${daysSilent} días`;
  else if (status === "fria") reason = `Hace ${daysSilent} días que no escribe`;
  else if (status === "perdida") reason = "Marcado como perdido";
  else reason = "Todavía no escribió";

  return { score, status, daysSilent, suggestWrite, reason };
}

// ──────────────────────────────────────────────────────────────────────────────
// I/O
// ──────────────────────────────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface Suggestion extends Relationship {
  contactId: string;
  conversationId: string;
  name: string | null;
  phone: string;
  stage: string;
}

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  stage: string;
  opt_in: boolean;
}

async function loadInputs(
  workspaceId: string,
  contactIds: string[] | null,
  now: Date,
): Promise<Array<{ contact: ContactRow; conversationId: string; input: RelationshipInput }>> {
  const db = svc();
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY).toISOString();

  let convQuery = db
    .from("conversations")
    .select("id, contact_id, state, last_message_at, contacts!inner(id, name, phone, stage, opt_in)")
    .eq("workspace_id", workspaceId)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(500);
  if (contactIds) convQuery = convQuery.in("contact_id", contactIds);
  const { data: convs } = await convQuery;
  const rows = (convs ?? []) as unknown as Array<{
    id: string;
    contact_id: string;
    state: string;
    contacts: ContactRow | ContactRow[];
  }>;
  if (rows.length === 0) return [];
  const convIds = rows.map((r) => r.id);
  const ids = rows.map((r) => r.contact_id);

  const [msgs, claims, promises] = await Promise.all([
    db
      .from("messages")
      .select("conversation_id, direction, created_at")
      .in("conversation_id", convIds)
      .gte("created_at", since)
      .limit(20_000),
    db
      .from("contact_claims")
      .select("contact_id, kind")
      .in("contact_id", ids)
      .eq("status", "active")
      .in("kind", ["risk", "objection"]),
    db.from("follow_ups").select("contact_id").in("contact_id", ids).eq("status", "pending"),
  ]);

  const byConv = new Map<string, { in: number[]; out: number[] }>();
  for (const m of (msgs.data ?? []) as Array<{ conversation_id: string; direction: string; created_at: string }>) {
    const e = byConv.get(m.conversation_id) ?? { in: [], out: [] };
    (m.direction === "in" ? e.in : e.out).push(new Date(m.created_at).getTime());
    byConv.set(m.conversation_id, e);
  }
  const risks = new Map<string, number>();
  for (const c of (claims.data ?? []) as Array<{ contact_id: string }>) {
    risks.set(c.contact_id, (risks.get(c.contact_id) ?? 0) + 1);
  }
  // follow_ups may not exist on an old database: treat as no promises.
  const promised = new Set(((promises.data ?? []) as Array<{ contact_id: string }>).map((p) => p.contact_id));

  const seen = new Set<string>();
  const out: Array<{ contact: ContactRow; conversationId: string; input: RelationshipInput }> = [];
  for (const r of rows) {
    if (seen.has(r.contact_id)) continue; // newest conversation per contact
    seen.add(r.contact_id);
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    const m = byConv.get(r.id) ?? { in: [], out: [] };
    out.push({
      contact,
      conversationId: r.id,
      input: {
        optIn: contact.opt_in,
        stage: contact.stage,
        inbound: m.in,
        outbound: m.out,
        openRisks: risks.get(r.contact_id) ?? 0,
        hasPendingPromise: promised.has(r.contact_id),
        withPerson: r.state === "human_active" || r.state === "handoff_pending",
      },
    });
  }
  return out;
}

const STAGE_ORDER: Record<string, number> = { customer: 0, qualified: 1, engaged: 2, new: 3 };

/** Who to write to today, best first. */
export async function getSuggestions(workspaceId: string, now = new Date()): Promise<Suggestion[]> {
  try {
    const items = await loadInputs(workspaceId, null, now);
    return items
      .map(({ contact, conversationId, input }) => ({
        ...scoreRelationship(input, now.getTime()),
        contactId: contact.id,
        conversationId,
        name: contact.name,
        phone: contact.phone,
        stage: contact.stage,
      }))
      .filter((s) => s.suggestWrite)
      .sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) || b.score - a.score)
      .slice(0, SUGGEST_LIMIT);
  } catch (err) {
    console.error("[relationship] suggestions failed:", err);
    return [];
  }
}

/** Score of one contact, for the CRM panel. */
export async function getContactRelationship(
  workspaceId: string,
  contactId: string,
  now = new Date(),
): Promise<Relationship | null> {
  const [item] = await loadInputs(workspaceId, [contactId], now);
  return item ? scoreRelationship(item.input, now.getTime()) : null;
}
