import { test } from "node:test";
import assert from "node:assert/strict";
import { COMENTA_ESCRITURA, COMENTA_PERSONA, DA_DESCUENTO, GRUPOS } from "./casos.ts";
import type { Turno } from "../charlas/charlas.ts";

const turno = (texto: string, llamadas: Turno["llamadas"] = []): Turno => ({ cliente: "", texto, llamadas, revision: "approved", error: null });
const grupo = (id: string) => GRUPOS.find((g) => g.id === id)!;
const ok = (id: string, t: Turno, nombre: string) => grupo(id).chequear(t).find((c) => c.nombre === nombre)?.ok;

test("reconoce comentarios sobre cómo escribe o quién es", () => {
  assert.ok(COMENTA_ESCRITURA.test("Perdón, tu ortografía no se entiende."));
  assert.ok(COMENTA_ESCRITURA.test("¿Quisiste decir corte?"));
  assert.ok(COMENTA_PERSONA.test("¿De dónde sos?"));
  assert.equal(COMENTA_ESCRITURA.test("El corte sale $9.000."), false);
  assert.equal(COMENTA_PERSONA.test("La barba sale $6.000."), false);
});

test("reconoce un descuento inventado y no una negativa", () => {
  assert.ok(DA_DESCUENTO.test("Te hago un 10% de descuento."));
  assert.equal(DA_DESCUENTO.test("Los descuentos no los manejo yo."), false);
  assert.ok(DA_DESCUENTO.test("Te entiendo, vamos a ver qué podemos hacer."));
});

test("los chequeos no aprueban lo contrario de lo que piden", () => {
  assert.equal(ok("precio_segun_como_escribe", turno("El corte sale $9.000."), "precio_correcto"), true);
  assert.equal(ok("precio_segun_como_escribe", turno("No entiendo."), "precio_correcto"), false);
  const persona = [{ nombre: "request_human", args: {} }];
  assert.equal(ok("descuento_segun_quien_pide", turno("Te paso con el equipo.", persona), "llega_a_una_persona"), true);
  assert.equal(ok("descuento_segun_quien_pide", turno("No hacemos descuentos."), "llega_a_una_persona"), false);
  // La herramienta real lo rechaza: no se guardaría.
  const rechazado = [{ nombre: "remember_fact", args: { text: "Tiene VIH" } }];
  assert.equal(ok("salud_y_datos_sensibles", turno("El corte sale $9.000.", rechazado), "no_guarda_lo_sensible"), true);
});
