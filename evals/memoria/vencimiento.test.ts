// Test sin red de cuánto dura cada dato de la memoria: cada tipo justo antes y justo
// después de vencer, con fechas fijas, y el formato que le llega al modelo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_TTL_DAYS, HUNCH_TTL_DAYS, claimsForPrompt, isClaimExpired, unexpiredClaims } from "@/features/arm/services/claim-expiry";
import { formatClaimsContext } from "@/features/arm/services/claims";
import { countOpenRisks, type RiskClaim } from "@/features/arm/services/relationship";
import type { ClaimKind, ClaimRow } from "@/features/arm/types";

const DIA = 86_400_000;
const AHORA = new Date("2026-11-03T15:00:00Z").getTime();
const hace = (dias: number, ms = 0) => new Date(AHORA - dias * DIA + ms).toISOString();
const dato = (over: Partial<ClaimRow>): ClaimRow => ({
  id: "c",
  workspace_id: "w",
  contact_id: "ana",
  kind: "need",
  text: "Busca un corte",
  source_message_id: "m",
  quote: null,
  author: "agent",
  status: "active",
  created_at: hace(1),
  ...over,
});

const PLAZOS: [ClaimKind, number][] = [["risk", 90], ["need", 180], ["goal", 180], ["objection", 180], ["commitment", 365]];

test("los plazos son los acordados", () => {
  assert.equal(HUNCH_TTL_DAYS, 30);
  assert.equal(CLAIM_TTL_DAYS.fact, null);
  for (const [kind, dias] of PLAZOS) assert.equal(CLAIM_TTL_DAYS[kind], dias);
});

for (const [kind, dias] of PLAZOS) {
  test(`${kind} con fuente: vence a los ${dias} días, ni antes ni después`, () => {
    assert.equal(isClaimExpired(dato({ kind, created_at: hace(dias, 1000) }), AHORA), false);
    assert.equal(isClaimExpired(dato({ kind, created_at: hace(dias) }), AHORA), true);
  });
}

test("un dato con fuente no vence nunca", () => {
  assert.equal(isClaimExpired(dato({ kind: "fact", created_at: hace(5000) }), AHORA), false);
});

test("una corazonada vence a los 30 días aunque sea de un tipo que no vence", () => {
  for (const kind of ["fact", "commitment", "need"] as ClaimKind[]) {
    const corazonada = { kind, source_message_id: null };
    assert.equal(isClaimExpired(dato({ ...corazonada, created_at: hace(30, 1000) }), AHORA), false);
    assert.equal(isClaimExpired(dato({ ...corazonada, created_at: hace(30) }), AHORA), true);
  }
});

test("lo que cargó una persona no es corazonada, aunque no cite un mensaje", () => {
  const humano = { source_message_id: null, author: "human" as const, created_at: hace(100) };
  assert.equal(isClaimExpired(dato({ ...humano, kind: "need" }), AHORA), false);
  assert.equal(isClaimExpired(dato({ ...humano, kind: "fact", created_at: hace(5000) }), AHORA), false);
});

test("una fecha ilegible no esconde el dato", () => {
  assert.equal(isClaimExpired(dato({ created_at: "" }), AHORA), false);
});

test("lo vencido no ocupa lugar: se saca antes de recortar a 20", () => {
  const vencidos = Array.from({ length: 30 }, (_, i) => dato({ id: `v${i}`, created_at: hace(200) }));
  const vigentes = Array.from({ length: 25 }, (_, i) => dato({ id: `s${i}`, created_at: hace(i) }));
  const elegidos = claimsForPrompt([...vencidos, ...vigentes], AHORA);
  assert.equal(elegidos.length, 20);
  assert.ok(elegidos.every((c) => c.id.startsWith("s")));
  assert.equal(elegidos[0].id, "s0");
  assert.equal(unexpiredClaims(vencidos, AHORA).length, 0);
});

test("cada dato le llega al modelo con su mes y su año", () => {
  const texto = formatClaimsContext([
    dato({ kind: "need", created_at: "2026-03-15T12:00:00Z" }),
    dato({ kind: "fact", source_message_id: null, created_at: "2026-10-31T12:00:00Z" }),
  ]);
  assert.match(texto, /\[need, con fuente, mar 2026\] «Busca un corte»/);
  assert.match(texto, /\[fact, corazonada, oct 2026\]/);
  assert.match(texto, /confirmalo antes de darlo por hecho/);
});

test("sin fecha legible, el dato sale igual y sin mes inventado", () => {
  assert.match(formatClaimsContext([dato({ created_at: "" })]), /\[need, con fuente\] «Busca un corte»/);
});

test("un riesgo vencido deja de bajar el puntaje", () => {
  const riesgo = (contact_id: string, created_at: string): RiskClaim => ({ contact_id, kind: "risk", created_at, source_message_id: "m", author: "agent" });
  const riesgos = countOpenRisks([riesgo("ana", hace(10)), riesgo("ana", hace(89)), riesgo("ana", hace(90)), riesgo("beto", hace(200))], AHORA);
  assert.equal(riesgos.get("ana"), 2);
  assert.equal(riesgos.has("beto"), false);
});
