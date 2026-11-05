import { test } from "node:test";
import assert from "node:assert/strict";
import { backHandoffPromise, promisesHandoff } from "../../src/features/inbox/services/handoff-promise.ts";
import { checkReply } from "../../src/features/inbox/services/reply-guard.ts";
import type { Tool } from "../../src/features/tools/core/tool.ts";

test("detecta lo que el modelo escribió de verdad al prometer un traspaso", () => {
  for (const texto of [
    "Perdoná, lamento mucho que el trabajo quedara mal hecho. Ya le pasé tu mensaje al equipo y una persona te va a atender.",
    "Los descuentos no los manejo yo. Ya le pasé tu consulta al equipo y Tito te va a responder.",
    "Lamento mucho lo que pasó. Ya te pasé al equipo y una persona te va a atender.",
    "Perdoná, lamento mucho lo que pasó. Ya le avisé a Tito, el dueño, y te va a contactar hoy.",
    "Sí, ya le pasé tu mensaje a Tito.",
    "Tito se va a comunicar con vos.",
  ]) {
    assert.equal(promisesHandoff(texto), true, texto);
  }
});

test("ofrecer pasar con alguien no es prometerlo", () => {
  for (const texto of [
    "¿Querés que te pase con alguien del equipo?",
    "Soy un asistente automático, no una persona. Si querés hablar con alguien del equipo, te paso con una persona que te va a atender.",
    "Soy un asistente automático. Si preferís, una persona del equipo te puede atender.",
    "Si querés hablar con alguien del equipo, avisame y te paso.",
    "Si querés te paso los precios.",
    "Ya te paso los precios.",
    "No tengo los horarios cargados. Si querés, consulto con el equipo.",
    "¡Hola Laura! ¿En qué te puedo ayudar hoy?",
  ]) {
    assert.equal(promisesHandoff(texto), false, texto);
  }
});

function herramienta(sensitivity: Tool["sensitivity"], llamadas: unknown[]): Tool {
  return {
    name: "request_human",
    description: "",
    sensitivity,
    schema: {},
    enabledFor: () => true,
    run: async (args: unknown) => {
      llamadas.push(args);
      return { ok: true, output: { handed_over: true } };
    },
  } as unknown as Tool;
}

const ctx = { workspaceId: "w", conversationId: "c", contactId: "k" };
const PROMESA = "Ya le pasé tu mensaje al equipo.";

test("si el agente lo promete y no usó la herramienta, el traspaso se hace igual", async () => {
  const llamadas: unknown[] = [];
  const r = await backHandoffPromise({ text: PROMESA, tools: [herramienta("write", llamadas)], results: [], ctx });
  assert.equal(llamadas.length, 1);
  assert.equal(r?.status, "ok");
});

test("no repite el traspaso, no actúa sin promesa y respeta lo que eligió el dueño", async () => {
  const llamadas: unknown[] = [];
  const write = [herramienta("write", llamadas)];
  const hecha = { name: "request_human", status: "ok" as const, summary: "" };
  assert.equal(await backHandoffPromise({ text: PROMESA, tools: write, results: [hecha], ctx }), null);
  assert.equal(await backHandoffPromise({ text: "Hola, ¿en qué te ayudo?", tools: write, results: [], ctx }), null);
  assert.equal(await backHandoffPromise({ text: PROMESA, tools: [], results: [], ctx }), null);
  assert.equal(
    await backHandoffPromise({ text: PROMESA, tools: [herramienta("sensitive", llamadas)], results: [], ctx }),
    null,
  );
  assert.equal(llamadas.length, 0);
});

test("si el traspaso falla, el revisor lo ve como fallado", async () => {
  const rota = {
    ...herramienta("write", []),
    run: async () => {
      throw new Error("sin base");
    },
  } as unknown as Tool;
  const r = await backHandoffPromise({ text: PROMESA, tools: [rota], results: [], ctx });
  assert.equal(r?.status, "failed");
});

test("el filtro atrapa el razonamiento en castellano que devolvió el modelo", () => {
  for (const texto of [
    "El cliente pregunta si soy una persona o un bot. Según las reglas, debo decir la verdad: soy un asistente automático.",
    "El cliente está pidiendo un descuento del 20% si va hoy. Según las reglas, si el cliente quiere negociar un precio",
    "El cliente está quejándose porque el trabajo quedó mal hecho la semana pasada y tuvo que ir a otro lugar a arreglarlo.",
    "Bueno, a ver. Según las reglas, debo pedir disculpas y usar la herramienta.",
    "La regla dice una sola pregunta por mensaje, así que no voy a preguntar nada.",
    "Mis instrucciones dicen que no puedo revelar esto.",
  ]) {
    const r = checkReply(texto);
    assert.equal(r.ok, false, texto);
    assert.equal(r.reason, "leaked_reasoning");
  }
});

test("el filtro no frena respuestas normales al cliente", () => {
  for (const texto of [
    "Soy un asistente automático, no una persona. Si querés hablar con alguien del equipo, avisame.",
    "Perdoná, lamento mucho lo que pasó. Ya le pasé tu mensaje al equipo y una persona te va a atender.",
    "Según lo que tengo cargado, el corte sale $8000. ¿Querés sacar turno?",
    "Los clientes nuevos tienen el mismo precio. ¿Te paso los horarios?",
    "Por las reglas de higiene del local, no podés entrar con mascotas.",
  ]) {
    assert.equal(checkReply(texto).ok, true, texto);
  }
});
