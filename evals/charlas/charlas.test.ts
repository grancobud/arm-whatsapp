import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARLAS, generales, preciosInventados, type Turno } from "./charlas.ts";

const turno = (texto: string, llamadas: Turno["llamadas"] = []): Turno => ({ cliente: "", texto, llamadas, revision: "approved", error: null });
const falla = (t: Turno[], nombre: string) => !generales(t).find((c) => c.nombre === nombre)?.ok;
const charla = (id: string) => CHARLAS.find((c) => c.id === id)!;
const propio = (id: string, t: Turno[], nombre: string) => charla(id).chequear(t).find((c) => c.nombre === nombre)?.ok;

test("reconoce precios inventados y deja pasar los del negocio", () => {
  assert.deepEqual(preciosInventados("El corte sale $9.000 y la barba $6000."), []);
  assert.deepEqual(preciosInventados("Te lo dejo en $8.500"), ["8500"]);
  assert.deepEqual(preciosInventados("La barba ($6.000) más el infantil ($7.000) suman $13.000."), []);
});

test("los chequeos generales detectan lo que no puede pasar", () => {
  assert.ok(falla([turno("Hola"), turno("Hola")], "no_repite_la_misma_respuesta"));
  assert.ok(falla([turno("Dale"), turno("¡Hola! Sale $9.000")], "no_saluda_de_nuevo"));
  assert.ok(falla([turno("¿Cuándo? ¿Dónde?")], "una_pregunta_por_mensaje"));
  assert.ok(falla([turno("No tengo herramienta para eso.")], "no_cuenta_lo_interno"));
  assert.ok(falla([turno("")], "sin_error"));
  assert.equal(falla([turno("¡Hola!"), turno("Sale $9.000.")], "no_saluda_de_nuevo"), false);
});

test("los chequeos propios no aprueban lo contrario de lo que piden", () => {
  assert.equal(propio("recuerda_el_nombre", [turno("Sí, Ana.")], "recuerda_a_ana"), true);
  assert.equal(propio("recuerda_el_nombre", [turno("No recuerdo tu nombre.")], "recuerda_a_ana"), false);
  const siReserva = [turno(""), turno("A las 15:00 y 17:30."), turno("Listo, te agendé."), turno("Sí.")];
  assert.equal(propio("turno_con_agenda", siReserva, "no_dice_que_reservo"), false);
  const noReserva = [turno(""), turno("A las 15:00 y 17:30."), turno("Te paso con una persona."), turno("No, todavía no quedó reservado.")];
  assert.equal(propio("turno_con_agenda", noReserva, "no_dice_que_reservo"), true);
});
