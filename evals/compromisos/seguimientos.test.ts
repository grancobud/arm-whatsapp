// Test sin red de los compromisos: cuándo se manda lo que el agente prometió,
// cuándo pasa a una persona y qué fechas se rechazan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFollowUp, validateDueAt, type FollowUpRow } from "@/features/arm/services/follow-ups";

const NOW = new Date("2026-11-05T15:00:00Z"); // jueves 12:00 en Buenos Aires
const TZ = "America/Argentina/Buenos_Aires";
const fu = (due: string): FollowUpRow => ({
  id: "f1",
  workspace_id: "w1",
  conversation_id: "c1",
  due_at: due,
  message: "¡Hola! Te escribo como quedamos.",
});
const open = { state: "ai_active" as const, window_expires_at: "2026-11-05T20:00:00Z" };

test("vencido, con la ventana abierta y la IA a cargo: se manda", () => {
  assert.deepEqual(decideFollowUp(fu("2026-11-05T14:00:00Z"), open, NOW, TZ), { action: "send" });
});

test("todavía no venció: espera", () => {
  assert.deepEqual(decideFollowUp(fu("2026-11-06T13:00:00Z"), open, NOW, TZ), { action: "wait" });
});

test("fuera del horario del negocio: espera a la mañana", () => {
  const night = new Date("2026-11-05T06:00:00Z"); // 3 a. m.
  assert.deepEqual(decideFollowUp(fu("2026-11-05T05:00:00Z"), open, night, TZ), { action: "wait" });
});

test("pasaron las 24 h: lo tiene que mandar una persona con plantilla", () => {
  const closed = { state: "ai_active" as const, window_expires_at: "2026-11-04T10:00:00Z" };
  assert.equal(decideFollowUp(fu("2026-11-05T14:00:00Z"), closed, NOW, TZ).action, "needs_human");
});

test("si la conversación la tomó una persona, decide ella", () => {
  const human = { ...open, state: "human_active" as const };
  assert.equal(decideFollowUp(fu("2026-11-05T14:00:00Z"), human, NOW, TZ).action, "needs_human");
});

test("conversación cerrada o en pausa (baja): se cancela", () => {
  for (const state of ["closed", "paused"] as const) {
    assert.equal(decideFollowUp(fu("2026-11-05T14:00:00Z"), { ...open, state }, NOW, TZ).action, "cancel");
  }
  assert.equal(decideFollowUp(fu("2026-11-05T14:00:00Z"), null, NOW, TZ).action, "cancel");
});

test("la fecha tiene que traer offset, ser futura y dentro de 60 días", () => {
  assert.ok("date" in validateDueAt("2026-11-06T10:00:00-03:00", NOW));
  assert.ok("date" in validateDueAt("2026-11-06T13:00:00Z", NOW));
  assert.ok("error" in validateDueAt("2026-11-06T10:00:00", NOW)); // sin offset
  assert.ok("error" in validateDueAt("mañana", NOW));
  assert.ok("error" in validateDueAt("2026-11-05T15:05:00Z", NOW)); // en 5 minutos
  assert.ok("error" in validateDueAt("2027-03-01T10:00:00-03:00", NOW)); // más de 60 días
});
