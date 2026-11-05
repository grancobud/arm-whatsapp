import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { APICallError } from "ai";
import { safeError } from "@/lib/safe-error";
import { evaluateHealth } from "@/features/alerts/health";
import { alertWorthyEvents, buildDigest, reportUnexpectedError, REVIEW_FAILURE_BURST, type AlertEvent } from "@/features/alerts/alerts";
import { summarizeOperations } from "@/features/agency/services/operations";

const llamada = () =>
  new APICallError({
    message: "sin cupo",
    url: "http://llm/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: "MENSAJE-DEL-CLIENTE" }] },
    statusCode: 429,
    responseBody: "{}",
  });

test("un error del modelo trae el mensaje del cliente, y safeError no lo deja pasar", () => {
  assert.ok(inspect(llamada(), { depth: 6 }).includes("MENSAJE-DEL-CLIENTE"));
  const seguro = safeError(llamada());
  assert.doesNotMatch(seguro, /MENSAJE-DEL-CLIENTE/);
  assert.match(seguro, /sin cupo/);
});

test("safeError entiende errores de la base y valores raros", () => {
  assert.equal(safeError({ message: "duplicate key", code: "23505", details: "dato" }), "23505: duplicate key");
  assert.equal(safeError("texto"), "texto");
  assert.equal(safeError({ algo: 1 }), "error sin mensaje");
  assert.equal(safeError(new Error("x".repeat(500))).length, 300);
});

test("la salud detecta lo que deja de pasar", () => {
  const bien = { databaseOk: true, overdueBatches: 0, stuckBatches: 0, overdueFollowUps: 0 };
  assert.deepEqual(evaluateHealth(bien), { ok: true, problems: [] });
  assert.equal(evaluateHealth({ ...bien, databaseOk: false }).ok, false);
  assert.match(evaluateHealth({ ...bien, overdueBatches: 2 }).problems[0], /cron/);
  assert.equal(evaluateHealth({ ...bien, stuckBatches: 1 }).ok, false);
  assert.equal(evaluateHealth({ ...bien, overdueFollowUps: 1 }).ok, false);
});

const fallaRevisor = (outcome = "review_failed"): AlertEvent => ({
  workspace_id: "w",
  type: "reply_review",
  level: "warn",
  payload: { outcome, error: "sin cupo" },
  created_at: "2026-11-05T10:00:00Z",
});

test("una falla suelta del revisor no alerta, muchas juntas sí", () => {
  assert.equal(alertWorthyEvents([fallaRevisor()]).length, 0);
  const muchas = Array.from({ length: REVIEW_FAILURE_BURST }, () => fallaRevisor());
  assert.equal(alertWorthyEvents(muchas).length, REVIEW_FAILURE_BURST);
  assert.equal(buildDigest(muchas, { w: "Cliente" })[0].count, REVIEW_FAILURE_BURST);
  // Que el revisor corrija una respuesta es que anda: no cuenta.
  assert.equal(alertWorthyEvents(Array.from({ length: 9 }, () => fallaRevisor("rewritten"))).length, 0);
});

test("un error no previsto avisa sin contenido y sin inundar el correo", async () => {
  process.env.RESEND_API_KEY = "falsa";
  process.env.ALERT_EMAIL_TO = "lab@ejemplo.test";
  const original = globalThis.fetch;
  const cuerpos: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    cuerpos.push(String(init?.body));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const ahora = Date.now() + 1000 * 60 * 60 * 24;
    assert.equal(await reportUnexpectedError("/api/algo?secreto=1", llamada(), ahora), true);
    assert.equal(await reportUnexpectedError("/api/algo", llamada(), ahora + 60_000), false);
    assert.equal(await reportUnexpectedError("/api/algo", llamada(), ahora + 31 * 60_000), true);
    assert.equal(cuerpos.length, 2);
    assert.doesNotMatch(cuerpos[0], /MENSAJE-DEL-CLIENTE/);
    assert.doesNotMatch(cuerpos[0], /secreto=1/);
  } finally {
    globalThis.fetch = original;
    console.error = errorOriginal;
    delete process.env.RESEND_API_KEY;
    delete process.env.ALERT_EMAIL_TO;
  }
});

test("el resumen de operación cuenta bien y aguanta no tener datos", () => {
  const turno = (total_ms: number, extra = {}) => ({ type: "turn_completed", level: "info", payload: { total_ms, model: "m1", ...extra } });
  const r = summarizeOperations([
    turno(1000),
    turno(2000, { review: "review_failed", forced_handoff: true }),
    turno(9000, { booking_offer_removed: true }),
    { type: "batch_dead_letter", level: "error", payload: null },
    { type: "dispatch_failure", level: "error", payload: null },
    { type: "llm_failover", level: "warn", payload: null },
  ]);
  assert.equal(r.turns, 3);
  assert.equal(r.medianMs, 2000);
  assert.equal(r.p95Ms, 9000);
  assert.equal(r.unreviewed, 1);
  assert.equal(r.forcedHandoffs, 1);
  assert.equal(r.guardsActed, 1);
  assert.equal(r.noReply, 1);
  assert.equal(r.sendFailures, 1);
  assert.equal(r.providerSwitches, 1);
  assert.deepEqual(r.models, [{ model: "m1", turns: 3 }]);
  assert.equal(summarizeOperations([]).medianMs, null);
});
