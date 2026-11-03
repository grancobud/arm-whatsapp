// Test sin red del motor de automatizaciones: qué regla se dispara, cuándo, y
// que nunca se dispare sobre el historial ni dos veces por lo mismo.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesKeyword,
  selectFirings,
  withinSendingHours,
  type ConversationRow,
  type MessageRow,
  type Rule,
  type Snapshot,
} from "@/features/automations/engine";

const NOW = new Date("2026-11-03T15:00:00Z"); // 12:00 en Buenos Aires
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1",
  workspace_id: "w1",
  name: "regla",
  trigger_type: "first_message",
  trigger_config: {},
  action_type: "add_tag",
  action_config: { tag: "nuevo" },
  updated_at: ago(24 * 60 * 10), // guardada hace 10 días
  ...over,
});

const conv = (over: Partial<ConversationRow>): ConversationRow => ({
  id: "c1",
  workspace_id: "w1",
  contact_id: "k1",
  state: "ai_active",
  created_at: ago(5),
  last_message_at: ago(1),
  window_expires_at: ahead(23 * 60),
  ...over,
});

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: "m1",
  conversation_id: "c1",
  direction: "in",
  body: "hola",
  created_at: ago(1),
  ...over,
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  conversations: [conv({})],
  messages: [msg({})],
  handoffs: [],
  qualified: [],
  ...over,
});

test("primer mensaje: una vez por conversación nueva que nos escribió", () => {
  const f = selectFirings([rule({})], snap({}), NOW);
  assert.deepEqual(f.map((x) => x.fireKey), ["first:c1"]);
  // Conversación vieja (antes de la ventana): no.
  assert.equal(selectFirings([rule({})], snap({ conversations: [conv({ created_at: ago(120) })] }), NOW).length, 0);
  // La abrió una campaña y el contacto todavía no escribió: no.
  assert.equal(selectFirings([rule({})], snap({ messages: [msg({ direction: "out" })] }), NOW).length, 0);
});

test("no se dispara sobre lo que pasó antes de guardar la regla", () => {
  const r = rule({ updated_at: ago(2) }); // guardada hace 2 min; la conversación es de hace 5
  assert.equal(selectFirings([r], snap({}), NOW).length, 0);
});

test("no toca conversaciones cerradas ni de otro cliente", () => {
  assert.equal(selectFirings([rule({})], snap({ conversations: [conv({ state: "closed" })] }), NOW).length, 0);
  assert.equal(selectFirings([rule({ workspace_id: "w2" })], snap({}), NOW).length, 0);
});

test("palabra clave: sin tildes ni mayúsculas, una vez por mensaje", () => {
  const r = rule({ trigger_type: "keyword_match", trigger_config: { keywords: ["precio", "cuánto sale"] } });
  const s = snap({
    messages: [
      msg({ id: "m1", body: "Hola, ¿CUANTO SALE el corte?" }),
      msg({ id: "m2", body: "y el precio del tinte" }),
      msg({ id: "m3", body: "gracias" }),
      msg({ id: "m4", body: "precio", direction: "out" }),
    ],
  });
  assert.deepEqual(selectFirings([r], s, NOW).map((x) => x.fireKey).sort(), ["kw:m1", "kw:m2"]);
  assert.equal(matchesKeyword("hola", []), false);
  assert.equal(matchesKeyword("hola", [" "]), false);
});

test("pedido de persona: no reacciona a un pase hecho por otra automatización", () => {
  const r = rule({ trigger_type: "handoff_requested" });
  const s = snap({
    handoffs: [
      { id: "e1", conversation_id: "c1", trigger: "keyword", created_at: ago(3) },
      { id: "e2", conversation_id: "c1", trigger: "automation", created_at: ago(2) },
    ],
  });
  assert.deepEqual(selectFirings([r], s, NOW).map((x) => x.fireKey), ["handoff:e1"]);
});

test("lead calificado: una vez por contacto, en su conversación más reciente", () => {
  const r = rule({ trigger_type: "lead_qualified" });
  const s = snap({
    conversations: [conv({ id: "vieja", last_message_at: ago(600) }), conv({ id: "c1" })],
    qualified: [{ contact_id: "k1", updated_at: ago(4) }],
  });
  const f = selectFirings([r], s, NOW);
  assert.deepEqual(f.map((x) => [x.conversationId, x.fireKey]), [["c1", "qualified:k1"]]);
});

test("sin respuesta: seguimiento único por silencio, nunca una cadena", () => {
  const r = rule({ trigger_type: "inactivity_24h", action_type: "send_template", action_config: { template_name: "seguimiento" } });
  const base = {
    conversations: [conv({ last_message_at: ago(25 * 60) })],
    messages: [
      msg({ id: "in1", direction: "in", created_at: ago(26 * 60) }),
      msg({ id: "out1", direction: "out", created_at: ago(25 * 60) }),
    ],
  };
  assert.deepEqual(selectFirings([r], snap(base), NOW).map((x) => x.fireKey), ["inactive:in1"]);

  // Ya mandamos el seguimiento y pasaron otras 24 h sin respuesta: misma clave,
  // así que el reclamo en automation_runs la frena.
  const later = snap({
    ...base,
    messages: [...base.messages, msg({ id: "tpl", direction: "out", created_at: ago(24 * 60 + 5) })],
  });
  assert.deepEqual(selectFirings([r], later, NOW).map((x) => x.fireKey), ["inactive:in1"]);

  // El último en hablar fue el contacto: no corresponde.
  const answered = snap({ ...base, messages: [...base.messages, msg({ id: "in2", created_at: ago(60) })] });
  assert.equal(selectFirings([r], answered, NOW).length, 0);

  // Todavía no pasaron 24 h.
  const early = snap({ messages: [msg({ id: "out1", direction: "out", created_at: ago(60) })] });
  assert.equal(selectFirings([r], early, NOW).length, 0);

  // Horas configurables.
  const r2 = rule({ ...r, trigger_config: { hours: 1 } });
  assert.equal(selectFirings([r2], early, NOW).length, 1);
});

test("ventana por cerrar: dentro de las últimas 2 h, una vez por ventana", () => {
  const r = rule({ trigger_type: "window_closing" });
  const closing = snap({ conversations: [conv({ window_expires_at: ahead(90) })] });
  assert.equal(selectFirings([r], closing, NOW).length, 1);
  assert.equal(selectFirings([r], snap({ conversations: [conv({ window_expires_at: ahead(300) })] }), NOW).length, 0);
  assert.equal(selectFirings([r], snap({ conversations: [conv({ window_expires_at: ago(5) })] }), NOW).length, 0);
});

test("horario de envío según la zona del negocio", () => {
  assert.equal(withinSendingHours(NOW, "America/Argentina/Buenos_Aires"), true); // 12 h
  assert.equal(withinSendingHours(new Date("2026-11-03T06:00:00Z"), "America/Argentina/Buenos_Aires"), false); // 3 h
  assert.equal(withinSendingHours(NOW, "Zona/Inventada"), true); // cae en la zona por defecto
});
