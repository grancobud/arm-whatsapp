// Test sin red de la autonomía graduada: qué exige aprobación según lo que
// eligió el dueño, y cuándo se sugiere dejar al agente hacerlo solo.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVALS_TO_PROMOTE,
  defaultMode,
  effectiveSensitivity,
  parseAutonomy,
  trackRecord,
} from "@/features/tools/lib/autonomy";

test("por defecto: lo sensible se propone, lo demás lo hace solo", () => {
  assert.equal(defaultMode("sensitive"), "propose");
  assert.equal(defaultMode("write"), "auto");
  assert.equal(defaultMode("read"), "auto");
});

test("lo que elige el dueño cambia lo que pide aprobación", () => {
  assert.equal(effectiveSensitivity("write", "propose"), "sensitive"); // agendar: que lo apruebe alguien
  assert.equal(effectiveSensitivity("sensitive", "auto"), "write"); // webhook: que lo haga solo, sin reintentos
  assert.equal(effectiveSensitivity("read", undefined), "read");
  assert.equal(effectiveSensitivity("sensitive", undefined), "sensitive");
});

test("lee la configuración guardada e ignora valores raros", () => {
  assert.deepEqual(parseAutonomy({ tool_autonomy: { a: "auto", b: "propose", c: "cualquiera" } }), {
    a: "auto",
    b: "propose",
  });
  assert.deepEqual(parseAutonomy(null), {});
  assert.deepEqual(parseAutonomy({ timezone: "x" }), {});
});

test("sugiere dejarlo solo tras 10 aprobaciones seguidas, nunca solo", () => {
  const ten = Array(APPROVALS_TO_PROMOTE).fill("executed");
  assert.equal(trackRecord(ten, "propose").suggestAuto, true);
  // Una rechazada reciente corta la racha.
  assert.equal(trackRecord(["rejected", ...ten], "propose").suggestAuto, false);
  // Una rechazada vieja no.
  assert.equal(trackRecord([...ten, "rejected"], "propose").suggestAuto, true);
  // Las pendientes no cuentan; "failed" es aprobada (falló después, no el criterio).
  const r = trackRecord(["pending", "failed", "executed", "rejected"], "propose");
  assert.deepEqual([r.approved, r.rejected, r.streak], [2, 1, 2]);
  // Si ya lo hace solo, no hay nada que sugerir.
  assert.equal(trackRecord(ten, "auto").suggestAuto, false);
});
