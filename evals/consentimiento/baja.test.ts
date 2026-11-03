// Test sin red de la baja por palabra clave: qué mensaje da de baja (o de
// alta) y, sobre todo, cuáles NO, para no desuscribir a nadie por error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyConsentMessage } from "@/features/inbox/services/opt-out";

test("da de baja con la palabra sola, sin importar mayúsculas, tildes ni signos", () => {
  for (const t of ["BAJA", "baja", " Baja. ", "STOP", "stop!", "Darme de baja", "no me escriban más", "No quiero recibir más mensajes"]) {
    assert.equal(classifyConsentMessage(t), "opt_out", t);
  }
});

test("da de baja con una frase clara en un mensaje corto", () => {
  assert.equal(classifyConsentMessage("Hola, por favor dejen de escribirme"), "opt_out");
  assert.equal(classifyConsentMessage("quiero que me den de baja, denme de baja"), "opt_out");
});

test("NO da de baja preguntas normales que contienen la palabra", () => {
  for (const t of [
    "¿Hay baja de precio?",
    "la baja de temperatura me arruinó la planta",
    "Quiero dar de baja mi turno del jueves y pasarlo al viernes",
    "¿Cuándo hacen stop de stock?",
    "Hola, quería consultar el precio",
    "",
  ]) {
    assert.equal(classifyConsentMessage(t), null, t);
  }
  assert.equal(classifyConsentMessage(null), null);
});

test("una frase dentro de un mensaje largo no cuenta", () => {
  const largo =
    "Les cuento que ayer fui al local y me atendieron bárbaro, mi vieja me dijo que no me manden más cosas pero yo quiero saber los horarios";
  assert.equal(classifyConsentMessage(largo), null);
});

test("ALTA vuelve a recibir mensajes", () => {
  for (const t of ["ALTA", "alta", "Start", "darme de alta"]) {
    assert.equal(classifyConsentMessage(t), "opt_in", t);
  }
  assert.equal(classifyConsentMessage("¿me das de alta en el gimnasio?"), null);
});
