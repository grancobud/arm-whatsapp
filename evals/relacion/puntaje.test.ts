// Test sin red del puntaje de la relación: quién está activo, quién se enfría
// y a quién conviene escribirle (y a quién nunca).

import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRelationship, type RelationshipInput } from "@/features/arm/services/relationship";

const NOW = new Date("2026-11-03T15:00:00Z").getTime();
const daysAgo = (d: number) => NOW - d * 86_400_000;
const input = (over: Partial<RelationshipInput>): RelationshipInput => ({
  optIn: true,
  stage: "engaged",
  inbound: [],
  outbound: [],
  openRisks: 0,
  hasPendingPromise: false,
  withPerson: false,
  ...over,
});

test("activo: escribió hace poco, contesta y es cliente → puntaje alto", () => {
  const r = scoreRelationship(
    input({ stage: "customer", inbound: [daysAgo(1), daysAgo(3), daysAgo(5)], outbound: [daysAgo(1.5), daysAgo(4)] }),
    NOW,
  );
  assert.equal(r.status, "activa");
  assert.ok(r.score >= 60, `score ${r.score}`);
  assert.equal(r.suggestWrite, false);
});

test("se enfría: calificado que no escribe hace 12 días → sugerir escribirle", () => {
  const r = scoreRelationship(input({ stage: "qualified", inbound: [daysAgo(12), daysAgo(14)] }), NOW);
  assert.equal(r.status, "enfriandose");
  assert.equal(r.suggestWrite, true);
  assert.match(r.reason, /calificado y hace 12 días/);
});

test("no sugiere si ya hay promesa agendada, si lo lleva una persona o si nunca hubo relación", () => {
  const cooling = { stage: "qualified", inbound: [daysAgo(12)] };
  assert.equal(scoreRelationship(input({ ...cooling, hasPendingPromise: true }), NOW).suggestWrite, false);
  assert.equal(scoreRelationship(input({ ...cooling, withPerson: true }), NOW).suggestWrite, false);
  assert.equal(scoreRelationship(input({ stage: "new", inbound: [daysAgo(12)] }), NOW).suggestWrite, false);
});

test("de baja: puntaje 0 y nunca se sugiere", () => {
  const r = scoreRelationship(input({ optIn: false, stage: "customer", inbound: [daysAgo(10)] }), NOW);
  assert.deepEqual([r.score, r.status, r.suggestWrite], [0, "baja", false]);
});

test("fría y perdida", () => {
  assert.equal(scoreRelationship(input({ inbound: [daysAgo(80)] }), NOW).status, "fria");
  assert.equal(scoreRelationship(input({ stage: "lost", inbound: [daysAgo(10)] }), NOW).status, "perdida");
  assert.equal(scoreRelationship(input({}), NOW).status, "nueva");
});

test("objeciones o riesgos abiertos bajan el puntaje y se nombran", () => {
  const base = { stage: "qualified", inbound: [daysAgo(10)] };
  const a = scoreRelationship(input(base), NOW);
  const b = scoreRelationship(input({ ...base, openRisks: 2 }), NOW);
  assert.equal(a.score - b.score, 10);
  assert.match(b.reason, /2 objeciones o riesgos/);
});
