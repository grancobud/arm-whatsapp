// Outcome metrics: what the ARM achieved, not how busy it was. Messages and
// conversations measure activity; a business wants to know how many turns got
// booked, how many leads qualified, how many customers came back after a
// campaign and whether the promises made to customers were kept.
//
// computeOutcomes is pure (tested in evals/metricas); getOutcomes only reads.

import { createClient as createSbClient } from "@supabase/supabase-js";

export const OUTCOME_DAYS = 30;
/** A campaign recipient "came back" if they wrote within this many days. */
export const REPLY_WINDOW_DAYS = 7;

export interface OutcomeEvent {
  type: string;
  conversation_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface InboundMessage {
  conversation_id: string;
  created_at: string;
}

export interface CampaignRecipient {
  campaign_id: string;
  conversation_id: string | null;
  sent_at: string | null;
}

export interface AgentActivation {
  agentId: string;
  at: string;
}

export interface AgentOutcome {
  agentId: string;
  name: string;
  type: string;
  bookings: number;
  qualifiedLeads: number;
  conversations: number;
  aiOnlyPct: number | null;
}

/**
 * Pure: the agent that was active at a given moment. Only one agent is active
 * per workspace, and every activation is an agent_activated event; before the
 * first one, nobody (null).
 */
export function agentAt(timeline: AgentActivation[], at: string): string | null {
  const t = new Date(at).getTime();
  let current: string | null = null;
  for (const a of timeline) {
    if (new Date(a.at).getTime() <= t) current = a.agentId;
    else break;
  }
  return current;
}

/** Pure: outcomes split by the agent that was active when each thing happened. */
export function computeOutcomesByAgent(input: {
  events: OutcomeEvent[];
  inbound: InboundMessage[];
  timeline: AgentActivation[];
  agents: Array<{ id: string; name: string; type: string }>;
}): AgentOutcome[] {
  const timeline = [...input.timeline].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const rows = new Map<string, { bookings: number; qualified: Set<string>; convs: Set<string>; aiOnly: number }>();
  const row = (id: string) => {
    let r0 = rows.get(id);
    if (!r0) rows.set(id, (r0 = { bookings: 0, qualified: new Set(), convs: new Set(), aiOnly: 0 }));
    return r0;
  };

  for (const e of input.events) {
    const agent = agentAt(timeline, e.created_at);
    if (!agent) continue;
    if (e.type === "tool_call" && e.payload?.tool_name === "schedule_highlevel" && e.payload?.result_ok === true) {
      row(agent).bookings++;
    }
    if (e.type === "setter_evaluation" && e.payload?.qualified === true) {
      row(agent).qualified.add(String(e.payload.contact_id ?? e.conversation_id));
    }
  }

  // A conversation belongs to the agent active at its latest inbound message.
  const lastIn = new Map<string, string>();
  for (const m of input.inbound) {
    const prev = lastIn.get(m.conversation_id);
    if (!prev || m.created_at > prev) lastIn.set(m.conversation_id, m.created_at);
  }
  const neededPerson = new Set(
    input.events
      .filter((e) => e.type === "state_change" && (e.payload?.to === "handoff_pending" || e.payload?.to === "human_active"))
      .map((e) => e.conversation_id),
  );
  for (const [conv, at] of lastIn) {
    const agent = agentAt(timeline, at);
    if (!agent) continue;
    row(agent).convs.add(conv);
    if (!neededPerson.has(conv)) row(agent).aiOnly++;
  }

  const byId = new Map(input.agents.map((a) => [a.id, a]));
  return [...rows.entries()]
    .map(([agentId, x]) => ({
      agentId,
      name: byId.get(agentId)?.name ?? "Agente borrado",
      type: byId.get(agentId)?.type ?? "",
      bookings: x.bookings,
      qualifiedLeads: x.qualified.size,
      conversations: x.convs.size,
      aiOnlyPct: x.convs.size ? Math.round((x.aiOnly / x.convs.size) * 100) : null,
    }))
    .sort((a, b) => b.conversations - a.conversations);
}

export interface Outcomes {
  bookings: number;
  bookingLinks: number;
  qualifiedLeads: number;
  conversations: number;
  aiOnlyConversations: number;
  /** null when there were no conversations */
  aiOnlyPct: number | null;
  optOuts: number;
  campaigns: Array<{ id: string; name: string; sent: number; replied: number; optOuts: number }>;
  /** null when follow-ups aren't available (migration not applied) */
  promises: { kept: number; needsHuman: number; cancelled: number; failed: number; pending: number } | null;
  /** Filled by getOutcomes; computeOutcomes leaves it empty. */
  byAgent: AgentOutcome[];
}

const DAY = 86_400_000;

export function computeOutcomes(input: {
  events: OutcomeEvent[];
  inbound: InboundMessage[];
  recipients: CampaignRecipient[];
  campaignNames: Record<string, string>;
  followUpStatuses: string[] | null;
}): Outcomes {
  const ok = (e: OutcomeEvent, tool: string) =>
    e.type === "tool_call" && e.payload?.tool_name === tool && e.payload?.result_ok === true;

  const bookings = input.events.filter((e) => ok(e, "schedule_highlevel")).length;
  const bookingLinks = input.events.filter((e) => ok(e, "schedule_link")).length;

  const qualified = new Set<string>();
  for (const e of input.events) {
    if (e.type === "setter_evaluation" && e.payload?.qualified === true) {
      qualified.add(String(e.payload.contact_id ?? e.conversation_id));
    }
  }

  // Conversations the AI handled start to finish: someone wrote, and nobody
  // had to step in (no pass to a person) in the period.
  const talked = new Set(input.inbound.map((m) => m.conversation_id));
  const neededPerson = new Set(
    input.events
      .filter(
        (e) =>
          e.type === "state_change" &&
          (e.payload?.to === "handoff_pending" || e.payload?.to === "human_active"),
      )
      .map((e) => e.conversation_id),
  );
  const aiOnly = [...talked].filter((c) => !neededPerson.has(c)).length;

  const optOutEvents = input.events.filter((e) => e.type === "opt_out");

  const inboundByConv = new Map<string, number[]>();
  for (const m of input.inbound) {
    const list = inboundByConv.get(m.conversation_id) ?? [];
    list.push(new Date(m.created_at).getTime());
    inboundByConv.set(m.conversation_id, list);
  }
  const optOutByConv = new Map<string, number[]>();
  for (const e of optOutEvents) {
    if (!e.conversation_id) continue;
    const list = optOutByConv.get(e.conversation_id) ?? [];
    list.push(new Date(e.created_at).getTime());
    optOutByConv.set(e.conversation_id, list);
  }
  const within = (times: number[] | undefined, from: number) =>
    (times ?? []).some((t) => t > from && t <= from + REPLY_WINDOW_DAYS * DAY);

  const byCampaign = new Map<string, { sent: number; replied: number; optOuts: number }>();
  for (const r of input.recipients) {
    if (!r.sent_at) continue;
    const c = byCampaign.get(r.campaign_id) ?? { sent: 0, replied: 0, optOuts: 0 };
    c.sent++;
    const sentAt = new Date(r.sent_at).getTime();
    if (r.conversation_id && within(inboundByConv.get(r.conversation_id), sentAt)) c.replied++;
    if (r.conversation_id && within(optOutByConv.get(r.conversation_id), sentAt)) c.optOuts++;
    byCampaign.set(r.campaign_id, c);
  }

  let promises: Outcomes["promises"] = null;
  if (input.followUpStatuses) {
    const count = (s: string) => input.followUpStatuses!.filter((x) => x === s).length;
    promises = {
      kept: count("sent"),
      needsHuman: count("needs_human"),
      cancelled: count("cancelled"),
      failed: count("failed"),
      pending: count("pending") + count("sending"),
    };
  }

  return {
    bookings,
    bookingLinks,
    qualifiedLeads: qualified.size,
    conversations: talked.size,
    aiOnlyConversations: aiOnly,
    aiOnlyPct: talked.size ? Math.round((aiOnly / talked.size) * 100) : null,
    optOuts: optOutEvents.length,
    campaigns: [...byCampaign.entries()]
      .map(([id, c]) => ({ id, name: input.campaignNames[id] ?? "Campaña", ...c }))
      .sort((a, b) => b.sent - a.sent),
    promises,
    byAgent: [],
  };
}

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getOutcomes(workspaceId: string, now = new Date()): Promise<Outcomes> {
  const supabase = svc();
  const since = new Date(now.getTime() - OUTCOME_DAYS * DAY).toISOString();

  const [events, inbound, recipients, followUps, activations, agents] = await Promise.all([
    supabase
      .from("events")
      .select("type, conversation_id, payload, created_at")
      .eq("workspace_id", workspaceId)
      .in("type", ["tool_call", "setter_evaluation", "state_change", "opt_out"])
      .gte("created_at", since)
      .limit(10_000),
    supabase
      .from("messages")
      .select("conversation_id, created_at")
      .eq("workspace_id", workspaceId)
      .eq("direction", "in")
      .gte("created_at", since)
      .limit(10_000),
    supabase
      .from("campaign_recipients")
      .select("campaign_id, conversation_id, sent_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("sent_at", since)
      .limit(5_000),
    supabase
      .from("follow_ups")
      .select("status")
      .eq("workspace_id", workspaceId)
      .gte("due_at", since)
      .limit(5_000),
    // All activations (not only the period's): who was active when it started.
    supabase
      .from("events")
      .select("payload, created_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "agent_activated")
      .order("created_at", { ascending: true })
      .limit(1_000),
    supabase.from("agents").select("id, name, type").eq("workspace_id", workspaceId),
  ]);

  const recipientRows = (recipients.data ?? []) as CampaignRecipient[];
  const campaignIds = [...new Set(recipientRows.map((r) => r.campaign_id))];
  const campaignNames: Record<string, string> = {};
  if (campaignIds.length) {
    const { data } = await supabase.from("campaigns").select("id, name").in("id", campaignIds);
    for (const c of (data ?? []) as Array<{ id: string; name: string }>) campaignNames[c.id] = c.name;
  }

  const eventRows = (events.data ?? []) as OutcomeEvent[];
  const inboundRows = (inbound.data ?? []) as InboundMessage[];
  const outcomes = computeOutcomes({
    events: eventRows,
    inbound: inboundRows,
    recipients: recipientRows,
    campaignNames,
    // The table comes with the follow-ups migration; until then, no section.
    followUpStatuses: followUps.error
      ? null
      : ((followUps.data ?? []) as Array<{ status: string }>).map((f) => f.status),
  });
  outcomes.byAgent = computeOutcomesByAgent({
    events: eventRows,
    inbound: inboundRows,
    timeline: ((activations.data ?? []) as Array<{ payload: { agent_id?: string } | null; created_at: string }>)
      .filter((a) => a.payload?.agent_id)
      .map((a) => ({ agentId: a.payload!.agent_id!, at: a.created_at })),
    agents: (agents.data ?? []) as Array<{ id: string; name: string; type: string }>,
  });
  return outcomes;
}
