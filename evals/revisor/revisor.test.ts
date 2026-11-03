// Test sin red del revisor de respuestas (evaluador-optimizador): cómo se lee
// el veredicto, qué le llega al revisor y el flujo entero con un modelo falso,
// incluido que nunca deje al cliente sin respuesta.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewInput,
  parseReview,
  reviewReply,
  toolOutcome,
  type Complete,
} from "@/features/inbox/services/reply-review";

test("lee el veredicto aunque venga con razonamiento o un ejemplo antes", () => {
  assert.deepEqual(parseReview('{"ok": true, "problems": []}'), { ok: true, problems: [] });
  const text =
    'El formato era {"ok": true, "problems": []}. Pero acá:\n```json\n{"ok": false, "problems": ["inventa un 20% de descuento"]}\n```';
  assert.deepEqual(parseReview(text), { ok: false, problems: ["inventa un 20% de descuento"] });
});

test("sin JSON usable devuelve null (y el borrador sale igual)", () => {
  assert.equal(parseReview("No encontré problemas."), null);
  assert.equal(parseReview('{"veredicto": "bien"}'), null);
});

test('"ok": false sin problemas no fuerza una reescritura sin motivo', () => {
  assert.deepEqual(parseReview('{"ok": false, "problems": []}'), { ok: true, problems: [] });
});

test("el revisor recibe todas las fuentes, las herramientas y el borrador", () => {
  const input = buildReviewInput("¿hacen envíos?", "Sí, enviamos gratis.", {
    business: "Envíos: solo CABA, $3.000",
    knowledge: "[F1] Política de envíos",
    memory: "Vive en Palermo",
    toolResults: [
      { name: "check_availability", status: "ok", summary: '{"slots":["10:00"]}' },
      { name: "schedule_highlevel", status: "pending", summary: "pendiente" },
    ],
    toolNames: ["check_availability", "schedule_highlevel"],
  });
  for (const parte of ["Envíos: solo CABA", "[F1]", "Palermo", "check_availability: OK", "PENDIENTE DE APROBACIÓN", "<borrador>\nSí, enviamos gratis."]) {
    assert.ok(input.includes(parte), `falta: ${parte}`);
  }
  // Sin datos, se dice explícitamente (que el revisor no suponga que hay).
  const vacio = buildReviewInput("hola", "Hola!", {});
  assert.ok(vacio.includes("no hay información del negocio cargada"));
  assert.ok(vacio.includes("no usó ninguna herramienta"));
});

test("el resultado de una herramienta se lee como ok, falló o pendiente", () => {
  assert.equal(toolOutcome("a", { ok: true, output: { id: 1 } }).status, "ok");
  assert.equal(toolOutcome("a", { ok: false, output: null, error: "sin cupo" }).status, "failed");
  assert.equal(toolOutcome("a", { ok: false, output: {}, requiresConfirmation: true }).status, "pending");
  assert.equal(toolOutcome("a", { ok: false, output: null, error: "sin cupo" }).summary, "sin cupo");
});

function fake(...respuestas: Array<string | Error>): { complete: Complete; calls: string[] } {
  const calls: string[] = [];
  const complete: Complete = async (req) => {
    calls.push(req.system.slice(0, 20));
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return { text: r ?? "", finishReason: "stop", inputTokens: 10, outputTokens: 5 };
  };
  return { complete, calls };
}

const base = {
  draft: "Te hacemos 20% de descuento.",
  customerMessage: "¿tienen descuento?",
  agentSystemPrompt: "Sos el agente de la peluquería.",
  sources: {},
};

test("aprobado: sale el borrador y se hace una sola llamada", async () => {
  const f = fake('{"ok": true, "problems": []}');
  const r = await reviewReply({ ...base, complete: f.complete });
  assert.equal(r.outcome, "approved");
  assert.equal(r.text, base.draft);
  assert.equal(f.calls.length, 1);
});

const OK = '{"ok": true, "problems": []}';

test("con problemas: se reescribe con el prompt del agente y se vuelve a revisar", async () => {
  const f = fake('{"ok": false, "problems": ["inventa un descuento"]}', "No tenemos descuentos ahora, ¿querés que te pase los precios?", OK);
  const r = await reviewReply({ ...base, complete: f.complete });
  assert.equal(r.outcome, "rewritten");
  assert.equal(r.text, "No tenemos descuentos ahora, ¿querés que te pase los precios?");
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1], base.agentSystemPrompt.slice(0, 20));
  assert.equal(r.inputTokens, 30);
});

test("si la corrección sigue mal, se corrige otra vez, con tope", async () => {
  const mal = '{"ok": false, "problems": ["sigue diciendo que reservó"]}';
  const f = fake(mal, "Te reservé el jueves.", mal, "Te consulto el jueves con el equipo.", OK);
  const r = await reviewReply({ ...base, complete: f.complete });
  assert.equal(r.outcome, "rewritten");
  assert.equal(r.text, "Te consulto el jueves con el equipo.");
  assert.equal(r.problems.length, 2);

  // Tope: después de MAX_REWRITES correcciones sale la última, marcada para el equipo.
  const g = fake(mal, "v1", mal, "v2", mal, "v3", mal);
  const t = await reviewReply({ ...base, complete: g.complete });
  assert.equal(t.outcome, "unresolved");
  assert.equal(t.text, "v2");
  assert.equal(g.calls.length, 5);
});

test("si la segunda revisión falla, sale la corrección (ya arregló lo conocido)", async () => {
  const f = fake('{"ok": false, "problems": ["x"]}', "Corregido.", new Error("timeout"));
  const r = await reviewReply({ ...base, complete: f.complete });
  assert.equal(r.outcome, "rewritten");
  assert.equal(r.text, "Corregido.");
});

test("la reescritura saca la línea de fuentes y devuelve sus citas", async () => {
  const f = fake('{"ok": false, "problems": ["precio inventado"]}', "El corte sale $8.000.\nFUENTES: F1", OK);
  const r = await reviewReply({ ...base, complete: f.complete });
  assert.equal(r.text, "El corte sale $8.000.");
  assert.deepEqual(r.citedIds, ["F1"]);
});

test("nunca deja al cliente sin respuesta: si algo falla, sale el borrador", async () => {
  const casos: Array<[string, ReturnType<typeof fake>]> = [
    ["review_failed", fake(new Error("timeout"))],
    ["review_failed", fake("no sé")],
    ["rewrite_failed", fake('{"ok": false, "problems": ["x"]}', new Error("503"))],
    ["rewrite_failed", fake('{"ok": false, "problems": ["x"]}', "")],
    ["rewrite_failed", fake('{"ok": false, "problems": ["x"]}', "The user asks about discounts, we need to...")],
  ];
  for (const [outcome, f] of casos) {
    const r = await reviewReply({ ...base, complete: f.complete });
    assert.equal(r.outcome, outcome);
    assert.equal(r.text, base.draft);
  }
});
