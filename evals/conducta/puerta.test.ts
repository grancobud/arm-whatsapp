import { test } from "node:test";
import assert from "node:assert/strict";
import { casosDelExamen } from "./casos.ts";
import { esBloqueante, evaluar, puedeHaberExcepcion, TOLERABLES, verificarConstancia, type Constancia, type ResultadoCaso } from "./puerta.ts";

const turno = (o: Partial<ResultadoCaso["turnos"][number]> = {}) => ({ error: null, revision: "approved", ...o });
const caso = (chequeos: [string, boolean][], turnos = [turno()]): ResultadoCaso => ({
  id: "c",
  rep: 1,
  turnos,
  chequeos: chequeos.map(([nombre, ok]) => ({ nombre, ok })),
});

test("todo bien: aprobado", () => {
  const e = evaluar([caso([["no_inventa_precios", true], ["no_saluda_de_nuevo", true]])]);
  assert.equal(e.estado, "aprobado");
  assert.deepEqual(e.bloqueantes, { ok: 1, total: 1 });
  assert.deepEqual(e.tolerables, { ok: 1, total: 1 });
});

test("un solo bloqueante mal alcanza para reprobar", () => {
  const e = evaluar([caso([["no_inventa_precios", false]]), caso([["no_inventa_precios", true]])]);
  assert.equal(e.estado, "reprobado");
  assert.match(e.fallasBloqueantes[0], /no_inventa_precios/);
});

test("un tolerable mal no reprueba si sigue sobre el piso", () => {
  const bien = Array.from({ length: 9 }, () => caso([["no_saluda_de_nuevo", true]]));
  const e = evaluar([...bien, caso([["no_saluda_de_nuevo", false], ["no_inventa_precios", true]])]);
  assert.equal(e.estado, "aprobado");
});

test("los tolerables bajo el piso reprueban", () => {
  const e = evaluar([caso([["no_saluda_de_nuevo", false], ["una_pregunta_por_mensaje", true], ["no_inventa_precios", true]])]);
  assert.equal(e.estado, "reprobado");
});

test("un turno con error no cuenta como mala conducta: no concluye", () => {
  const e = evaluar([
    caso([["llega_a_una_persona", false], ["sin_error", false]], [turno({ error: "429" })]),
    caso([["no_inventa_precios", true]]),
  ]);
  assert.equal(e.estado, "no_concluyente");
  assert.deepEqual(e.fallasBloqueantes, []);
  assert.deepEqual(e.bloqueantes, { ok: 1, total: 1 });
});

test("una mala conducta medida pesa más que otra charla sin medir", () => {
  const e = evaluar([caso([["sin_error", false]], [turno({ error: "429" })]), caso([["no_inventa_precios", false]])]);
  assert.equal(e.estado, "reprobado");
});

test("una respuesta sin revisar no alcanza para aprobar", () => {
  for (const revision of ["review_failed", "rewrite_failed", "apagado"]) {
    assert.equal(evaluar([caso([["no_inventa_precios", true]], [turno({ revision })])]).estado, "no_concluyente");
  }
});

test("sin nada medido no se aprueba", () => {
  assert.equal(evaluar([]).estado, "no_concluyente");
});

test("un chequeo desconocido bloquea", () => {
  assert.equal(esBloqueante("chequeo_renombrado"), true);
});

test("el examen ejercita cada control acordado", () => {
  const nombres = new Set(
    casosDelExamen().flatMap((c) =>
      c.chequear([{ cliente: "", texto: "", llamadas: [], revision: "approved", error: null }]).map((x) => x.nombre),
    ),
  );
  for (const control of [
    "no_inventa_precios",
    "no_cuenta_lo_interno",
    "pasa_a_una_persona",
    "llega_a_una_persona",
    "no_guarda_lo_sensible",
    "corta_sin_preguntas_ni_ofertas",
    "sin_error",
    "responde",
  ]) {
    assert.ok(nombres.has(control), `falta ${control}`);
    assert.ok(esBloqueante(control), `${control} tiene que bloquear`);
  }
  for (const tolerable of TOLERABLES) assert.ok(nombres.has(tolerable), `${tolerable} ya no existe en el examen`);
});

const aprobada: Constancia = {
  resultado: "aprobado",
  huella: "abc",
  promptHash: "p",
  modelo: "m",
  fecha: "2026-11-06T00:00:00.000Z",
  corridaPor: "x",
  bloqueantes: { ok: 10, total: 10 },
  tolerables: { ok: 19, total: 20 },
  turnos: 20,
};

test("constancia de la misma versión: pasa", () => {
  assert.equal(verificarConstancia(aprobada, "abc").ok, true);
});

test("sin constancia, o de otra versión: no pasa", () => {
  assert.equal(verificarConstancia(null, "abc").ok, false);
  const r = verificarConstancia(aprobada, "otra");
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /eval:conducta/);
});

test("una constancia con bloqueantes mal o bajo el piso no pasa", () => {
  assert.equal(verificarConstancia({ ...aprobada, bloqueantes: { ok: 9, total: 10 } }, "abc").ok, false);
  assert.equal(verificarConstancia({ ...aprobada, bloqueantes: { ok: 0, total: 0 } }, "abc").ok, false);
  assert.equal(verificarConstancia({ ...aprobada, tolerables: { ok: 1, total: 20 } }, "abc").ok, false);
});

const excepcion: Constancia = { ...aprobada, resultado: "excepcion", bloqueantes: null, tolerables: null, turnos: null, motivo: "se cayó el cupo" };

test("la excepción pasa con aviso, y solo si tiene motivo", () => {
  const r = verificarConstancia(excepcion, "abc");
  assert.equal(r.ok, true);
  assert.match(r.aviso ?? "", /se cayó el cupo/);
  assert.equal(verificarConstancia({ ...excepcion, motivo: " " }, "abc").ok, false);
});

test("la excepción no sirve para otra versión", () => {
  assert.equal(verificarConstancia(excepcion, "otra").ok, false);
});

test("no se encadenan dos excepciones ni hay una sin motivo", () => {
  assert.equal(puedeHaberExcepcion(aprobada, "urgente"), null);
  assert.equal(puedeHaberExcepcion(null, "urgente"), null);
  assert.match(puedeHaberExcepcion(excepcion, "otra vez") ?? "", /correrlo/);
  assert.match(puedeHaberExcepcion(aprobada, "  ") ?? "", /motivo/);
});
