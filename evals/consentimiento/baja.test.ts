// Test sin red de la baja por palabra clave: qué mensaje da de baja (o de
// alta) y, sobre todo, cuáles NO, para no desuscribir a nadie por error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { classifyConsentMessage, optOutRequested, OPT_OUT_TOOL, promisesOptOut } from "@/features/inbox/services/opt-out";
import { applyTurnGuards } from "@/features/inbox/services/turn-guards";
import type { ToolOutcome } from "@/features/inbox/services/reply-review";
import { registerOptOutTool } from "@/features/tools/tools/register-opt-out";
import type { Tool } from "@/features/tools/core/tool";
import { CHARLAS } from "../charlas/charlas.ts";

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

test("da de baja con las formas que antes llegaban al agente sin registrarse", () => {
  for (const t of [
    "no quiero que me escriban más",
    "Bueno, no quiero que me escriban más, gracias",
    "sacame de la lista",
    "Sáquenme de la lista por favor",
    "borrame de la lista",
    "no me hablen más",
    "no me escribas más",
    "deja de escribirme",
    "basta de mensajes",
    "no me contacten más",
  ]) {
    assert.equal(classifyConsentMessage(t), "opt_out", t);
  }
});

test("las formas nuevas solo cuentan al final: si sigue la frase, lo decide el agente", () => {
  for (const t of [
    "sacame de la lista de espera",
    "borrame el turno del jueves",
    "borrame",
    "basta de esperar, ¿me atienden?",
    "no me hables más de ese corte",
    "no me mandes más el link que ya lo tengo",
    "no me escribas más hasta el lunes",
  ]) {
    assert.equal(classifyConsentMessage(t), null, t);
  }
});

// Si la lista absorbe estas frases, el examen deja de probar al agente y nadie se entera.
test("las charlas del examen de bajas siguen pasando por el agente", () => {
  for (const id of ["baja_con_otras_palabras", "pausa_no_es_baja"]) {
    const charla = CHARLAS.find((c) => c.id === id);
    assert.ok(charla, id);
    for (const m of charla.mensajes) assert.equal(classifyConsentMessage(m), null, m);
  }
});

test("una promesa de baja se reconoce; una despedida o una oferta, no", () => {
  for (const t of [
    "Listo, no te vamos a escribir más. ¡Que andes bien!",
    "Listo, no te escribimos más",
    "Ya te dimos de baja.",
    "No te vamos a mandar más mensajes, ¡gracias!",
  ]) {
    assert.equal(promisesOptOut(t), true, t);
  }
  for (const t of [
    "Dale, no te molesto más. ¡Que andes bien!",
    "No te vamos a mandar el link hasta que confirmes.",
    "Si querés, no te escribimos más.",
    "¿Querés que no te escribamos más?",
    "Hoy no te escribo más info.",
  ]) {
    assert.equal(promisesOptOut(t), false, t);
  }
});

test("el turno cumple la promesa de baja y deja de lado el resto de las guardias", async () => {
  const llamadas: unknown[] = [];
  const pasar: Tool = {
    name: "request_human",
    description: "",
    sensitivity: "write",
    schema: z.object({}),
    enabledFor: () => true,
    run: async () => {
      llamadas.push("request_human");
      return { ok: true, output: {} };
    },
  };
  const results: ToolOutcome[] = [];
  const r = await applyTurnGuards({
    text: "Listo, no te vamos a escribir más. Una persona te va a atender.",
    customerText: "ya no quiero nada con ustedes, me atendieron mal",
    tools: [pasar, registerOptOutTool],
    results,
    ctx: { workspaceId: "w", conversationId: "", contactId: "" },
  });
  assert.equal(optOutRequested(results), true);
  assert.equal(r.forcedHandoff, null);
  assert.equal(llamadas.length, 0);
});

test("sin la herramienta no hay baja forzada, y un pedido fallido no cuenta", async () => {
  const results: ToolOutcome[] = [];
  await applyTurnGuards({
    text: "Listo, no te vamos a escribir más.",
    customerText: "chau",
    tools: [],
    results,
    ctx: { workspaceId: "w", conversationId: "", contactId: "" },
  });
  assert.equal(optOutRequested(results), false);
  assert.equal(optOutRequested([{ name: OPT_OUT_TOOL, status: "failed" }]), false);
});

test("el chat de prueba simula la baja sin tocar nada", async () => {
  const r = await registerOptOutTool.run({ quote: "sáquenme" }, { workspaceId: "w", conversationId: "", contactId: "" });
  assert.equal(r.ok, true);
});

test("ALTA vuelve a recibir mensajes", () => {
  for (const t of ["ALTA", "alta", "Start", "darme de alta"]) {
    assert.equal(classifyConsentMessage(t), "opt_in", t);
  }
  assert.equal(classifyConsentMessage("¿me das de alta en el gimnasio?"), null);
});
