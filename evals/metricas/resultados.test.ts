// Test sin red de las métricas de resultados: qué cuenta como turno, lead,
// conversación resuelta por la IA, respuesta a una campaña y promesa cumplida.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOutcomes, type OutcomeEvent } from "@/features/dashboard/services/outcomes";

const ev = (over: Partial<OutcomeEvent>): OutcomeEvent => ({
  type: "tool_call",
  conversation_id: "c1",
  payload: {},
  created_at: "2026-11-01T12:00:00Z",
  ...over,
});
const base = { events: [], inbound: [], recipients: [], campaignNames: {}, followUpStatuses: null };

test("turnos: solo las reservas que salieron bien", () => {
  const o = computeOutcomes({
    ...base,
    events: [
      ev({ payload: { tool_name: "schedule_highlevel", result_ok: true } }),
      ev({ payload: { tool_name: "schedule_highlevel", result_ok: false } }),
      ev({ payload: { tool_name: "schedule_link", result_ok: true } }),
      ev({ payload: { tool_name: "remember_fact", result_ok: true } }),
    ],
  });
  assert.equal(o.bookings, 1);
  assert.equal(o.bookingLinks, 1);
});

test("leads calificados: una vez por contacto", () => {
  const o = computeOutcomes({
    ...base,
    events: [
      ev({ type: "setter_evaluation", payload: { qualified: true, contact_id: "k1" } }),
      ev({ type: "setter_evaluation", payload: { qualified: true, contact_id: "k1" } }),
      ev({ type: "setter_evaluation", payload: { qualified: false, contact_id: "k2" } }),
    ],
  });
  assert.equal(o.qualifiedLeads, 1);
});

test("resueltas por la IA: las que no pasaron a una persona", () => {
  const o = computeOutcomes({
    ...base,
    inbound: [
      { conversation_id: "c1", created_at: "2026-11-01T10:00:00Z" },
      { conversation_id: "c2", created_at: "2026-11-01T10:00:00Z" },
      { conversation_id: "c3", created_at: "2026-11-01T10:00:00Z" },
      { conversation_id: "c3", created_at: "2026-11-01T11:00:00Z" },
    ],
    events: [ev({ type: "state_change", conversation_id: "c2", payload: { to: "handoff_pending" } })],
  });
  assert.equal(o.conversations, 3);
  assert.equal(o.aiOnlyConversations, 2);
  assert.equal(o.aiOnlyPct, 67);
  assert.equal(computeOutcomes(base).aiOnlyPct, null);
});

test("campañas: contestó dentro de 7 días después del envío; bajas aparte", () => {
  const o = computeOutcomes({
    ...base,
    campaignNames: { k: "Reactivación" },
    recipients: [
      { campaign_id: "k", conversation_id: "a", sent_at: "2026-11-01T10:00:00Z" },
      { campaign_id: "k", conversation_id: "b", sent_at: "2026-11-01T10:00:00Z" },
      { campaign_id: "k", conversation_id: "c", sent_at: "2026-11-01T10:00:00Z" },
      { campaign_id: "k", conversation_id: "d", sent_at: null },
    ],
    inbound: [
      { conversation_id: "a", created_at: "2026-11-02T10:00:00Z" }, // contestó
      { conversation_id: "b", created_at: "2026-10-30T10:00:00Z" }, // antes del envío
      { conversation_id: "c", created_at: "2026-11-20T10:00:00Z" }, // pasados 7 días
    ],
    events: [ev({ type: "opt_out", conversation_id: "a", created_at: "2026-11-03T10:00:00Z" })],
  });
  assert.deepEqual(o.campaigns, [{ id: "k", name: "Reactivación", sent: 3, replied: 1, optOuts: 1 }]);
  assert.equal(o.optOuts, 1);
});

test("promesas: sin la tabla no hay sección; con ella se cuentan por estado", () => {
  assert.equal(computeOutcomes(base).promises, null);
  const o = computeOutcomes({ ...base, followUpStatuses: ["sent", "sent", "needs_human", "pending", "sending", "cancelled"] });
  assert.deepEqual(o.promises, { kept: 2, needsHuman: 1, cancelled: 1, failed: 0, pending: 2 });
});

test("por agente: cada resultado va al agente activo en ese momento", async () => {
  const { agentAt, computeOutcomesByAgent } = await import("@/features/dashboard/services/outcomes");
  const timeline = [
    { agentId: "setter", at: "2026-10-01T00:00:00Z" },
    { agentId: "agenda", at: "2026-11-02T00:00:00Z" },
  ];
  assert.equal(agentAt(timeline, "2026-09-30T00:00:00Z"), null);
  assert.equal(agentAt(timeline, "2026-11-01T00:00:00Z"), "setter");
  assert.equal(agentAt(timeline, "2026-11-03T00:00:00Z"), "agenda");

  const rows = computeOutcomesByAgent({
    timeline,
    agents: [
      { id: "setter", name: "Martín", type: "setter" },
      { id: "agenda", name: "Andrés", type: "agendamiento" },
    ],
    events: [
      ev({ type: "setter_evaluation", created_at: "2026-11-01T10:00:00Z", payload: { qualified: true, contact_id: "k1" } }),
      ev({ created_at: "2026-11-02T10:00:00Z", payload: { tool_name: "schedule_highlevel", result_ok: true } }),
      ev({ type: "state_change", conversation_id: "c2", created_at: "2026-11-02T11:00:00Z", payload: { to: "handoff_pending" } }),
    ],
    inbound: [
      { conversation_id: "c1", created_at: "2026-11-01T09:00:00Z" },
      { conversation_id: "c2", created_at: "2026-11-02T09:00:00Z" },
      { conversation_id: "c3", created_at: "2026-11-02T09:30:00Z" },
    ],
  });
  const by = Object.fromEntries(rows.map((r) => [r.agentId, r]));
  assert.deepEqual([by.setter.qualifiedLeads, by.setter.conversations, by.setter.aiOnlyPct], [1, 1, 100]);
  assert.deepEqual([by.agenda.bookings, by.agenda.conversations, by.agenda.aiOnlyPct], [1, 2, 50]);
  assert.equal(by.agenda.name, "Andrés");
});
