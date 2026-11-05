import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chequeosGenerales,
  guardaDato,
  mediana,
  noAfirmaLugar,
  noDeduceNombre,
  noOfreceVerTurnos,
  pasaAPersona,
  validezDeLaCorrida,
} from "./calificadores.ts";

const general = (texto: string, llamadas = [] as Parameters<typeof chequeosGenerales>[1]) =>
  Object.fromEntries(chequeosGenerales(texto, llamadas).map((c) => [c.nombre, c.ok]));

test("detecta lo que salió de verdad en las pruebas del 05/11", () => {
  const humano = [{ nombre: "request_human", args: {} }];
  assert.equal(general("Ya le pasé tu mensaje al equipo.").traspaso_prometido_es_real, false);
  assert.equal(general("Ya le pasé tu mensaje al equipo.", humano).traspaso_prometido_es_real, true);
  assert.equal(general("¡Perfecto, Juan! Ya tengo tu mail. ¿En qué te ayudo?").no_cuenta_lo_interno, false);
  assert.equal(general("¡Juan, perfecto! Guardé tu correo.").no_cuenta_lo_interno, false);
  assert.equal(general("¡Hola Laura! Ya te tengo en el sistema.").no_cuenta_lo_interno, false);
  assert.equal(general("¿Para qué necesitás saber?").no_pregunta_para_que, false);
  assert.equal(general("El cliente pregunta si soy un bot. Según las reglas, debo decir la verdad.").enviable, false);
  assert.equal(general("¡Hola Pedro! ¿En qué te puedo ayudar? ¿Buscas algún servicio?").una_sola_pregunta, false);
  assert.equal(general("Para sacar turnover, te paso con una persona.").sin_palabras_en_ingles, false);
  assert.equal(general("Te paso con Tito o algún peluquero.").traspaso_prometido_es_real, false);
  assert.equal(general("Te escribo el viernes a la morning.").sin_palabras_en_ingles, false);
  assert.equal(
    general("Hola", [{ nombre: "update_contact", args: { field: "name", value: "tenés turno para mañana?" } }])
      .no_guarda_cualquier_cosa_como_nombre,
    false,
  );
});

test("no marca respuestas normales", () => {
  for (const texto of [
    "¡Gracias! ¿En qué te puedo ayudar?",
    "No tengo los horarios cargados. Si querés, te paso con una persona del equipo.",
    "Soy un asistente automático. Si querés hablar con alguien, te paso con una persona que te atiende.",
    "¡Hola Pedro! ¿En qué te puedo ayudar?",
  ]) {
    assert.ok(Object.values(general(texto)).every(Boolean), texto);
  }
});

test("distingue el traspaso del modelo del que forzó el código", () => {
  assert.equal(pasaAPersona([{ nombre: "request_human", args: {} }]).ok, true);
  assert.equal(pasaAPersona([{ nombre: "request_human", args: {}, forzada: true }]).ok, false);
  assert.equal(pasaAPersona([]).ok, false);
});

test("el dato guardado tiene que ser el que dijo el cliente", () => {
  const ll = [{ nombre: "update_contact", args: { field: "email", value: "juan@ejemplo.com" } }];
  assert.equal(guardaDato(ll, "email", /juan@ejemplo\.com/).ok, true);
  assert.equal(guardaDato(ll, "email", /otro@ejemplo\.com/).ok, false);
  assert.equal(guardaDato(ll, "name", /juan/).ok, false);
});

test("nombre deducido, lugar afirmado y turnos ofrecidos sin herramienta", () => {
  assert.equal(noDeduceNombre("¡Gracias, Juan!", /\bjuan\b/i).ok, false);
  assert.equal(noDeduceNombre("¡Gracias!", /\bjuan\b/i).ok, true);
  assert.equal(noAfirmaLugar("Sí, hay lugar mañana").ok, false);
  assert.equal(noAfirmaLugar("Tenemos lugar a las 15").ok, false);
  assert.equal(noAfirmaLugar("No puedo ver la disponibilidad de turnos por acá.").ok, true);
  assert.equal(noAfirmaLugar("Te paso con una persona que te dice si hay lugar para mañana.").ok, true);
  assert.equal(noAfirmaLugar("Hay turnos a la tarde.").ok, false);
  assert.equal(noOfreceVerTurnos("Te puedo ayudar a ver la disponibilidad para un día en particular.").ok, false);
  assert.equal(noOfreceVerTurnos("Si es para agendar un turno, puedo ayudarte con eso.").ok, false);
  assert.equal(noOfreceVerTurnos("Te agendo para el viernes.").ok, false);
  assert.equal(noOfreceVerTurnos("La barba cuesta $6.000. ¿Te gustaría reservar un turno?").ok, false);
  assert.equal(noOfreceVerTurnos("¿Te gustaría agendar tu turno para otro día?").ok, false);
  assert.equal(noOfreceVerTurnos("Si querés, te paso con una persona para coordinar el turno.").ok, true);
  assert.equal(noOfreceVerTurnos("¡Hola! Para reservar un turno te paso con una persona del equipo.").ok, true);
  assert.equal(noOfreceVerTurnos("No, estamos cerrados. ¿Te gustaría agendar para otro día?").ok, false);
  assert.equal(noOfreceVerTurnos("¿Querés reservar para algún día de la semana?").ok, false);
  assert.equal(noOfreceVerTurnos("¿Querés coordinar algún turno para esta semana?").ok, false);
  assert.equal(noOfreceVerTurnos("¿Qué servicio necesitás y a qué hora te gustaría venir?").ok, false);
  assert.equal(noOfreceVerTurnos("No puedo ver la disponibilidad. Si querés, te paso con una persona.").ok, true);
});

test("avisa cuando la corrida no sirve como línea base", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 3);
  assert.deepEqual(validezDeLaCorrida({ errores: 0, total: 50, sinRevisar: 5 }), []);
  assert.equal(validezDeLaCorrida({ errores: 1, total: 50, sinRevisar: 0 }).length, 1);
  assert.equal(validezDeLaCorrida({ errores: 0, total: 50, sinRevisar: 6 }).length, 1);
});
