import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiShouldRespond,
  canTransition,
  transition,
  TransitionError,
  detectsHandoffTrigger,
  type ConversationState,
} from "../../src/features/inbox/services/state-machine.ts";

// ──────────────────────────────────────────────────────────────────────────────
// 1. aiShouldRespond: solo responde cuando el estado es 'ai_active'
// ──────────────────────────────────────────────────────────────────────────────

test("aiShouldRespond solo permite respuestas en ai_active", () => {
  assert.equal(aiShouldRespond("ai_active"), true);
  assert.equal(aiShouldRespond("human_active"), false);
  assert.equal(aiShouldRespond("handoff_pending"), false);
  assert.equal(aiShouldRespond("waiting_reply"), false);
  assert.equal(aiShouldRespond("paused"), false);
  assert.equal(aiShouldRespond("closed"), false);
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Máquina de estados: transiciones legales e ilegales
// ──────────────────────────────────────────────────────────────────────────────

test("canTransition valida el grafo de estados legal", () => {
  // Desde ai_active
  assert.equal(canTransition("ai_active", "human_active"), true);
  assert.equal(canTransition("ai_active", "handoff_pending"), true);
  assert.equal(canTransition("ai_active", "waiting_reply"), true);
  assert.equal(canTransition("ai_active", "paused"), true);
  assert.equal(canTransition("ai_active", "closed"), true);

  // Desde handoff_pending
  assert.equal(canTransition("handoff_pending", "human_active"), true);
  assert.equal(canTransition("handoff_pending", "ai_active"), true);
  assert.equal(canTransition("handoff_pending", "closed"), true);
  assert.equal(canTransition("handoff_pending", "paused"), false);

  // Desde human_active
  assert.equal(canTransition("human_active", "ai_active"), true);
  assert.equal(canTransition("human_active", "closed"), true);
  assert.equal(canTransition("human_active", "handoff_pending"), false);

  // Desde closed (estado terminal)
  assert.equal(canTransition("closed", "ai_active"), false);
  assert.equal(canTransition("closed", "human_active"), false);
});

test("transition lanza TransitionError en transiciones ilegales", () => {
  assert.throws(
    () => transition("closed", "ai_active"),
    (err: unknown) => err instanceof TransitionError,
  );
  assert.throws(
    () => transition("handoff_pending", "waiting_reply"),
    (err: unknown) => err instanceof TransitionError,
  );
  // Transición legal retorna el nuevo estado
  assert.equal(transition("ai_active", "handoff_pending"), "handoff_pending");
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. detectsHandoffTrigger: detección de pedidos de humano / soporte
// ──────────────────────────────────────────────────────────────────────────────

test("detectsHandoffTrigger reconoce frases explícitas de derivación", () => {
  const frases = [
    "Hola, quiero hablar con una persona real",
    "¿Me atiende un humano por favor?",
    "Necesito hablar con soporte humano urgente",
    "Pasame con un operador",
    "Quiero hablar con alguien del equipo",
    "Por favor que me atienda un agente",
    "con un humano",
  ];

  for (const f of frases) {
    assert.equal(
      detectsHandoffTrigger(f),
      true,
      `Debería detectar handoff en: "${f}"`,
    );
  }
});

test("detectsHandoffTrigger es insensible a mayúsculas y acentos", () => {
  assert.equal(detectsHandoffTrigger("QUIERO HABLAR CON UNA PERSONA"), true);
  assert.equal(detectsHandoffTrigger("¿Atiende un húmano?"), true);
  assert.equal(detectsHandoffTrigger("operadór"), true);
  assert.equal(detectsHandoffTrigger("necesito habláR con un agente"), true);
});

test("detectsHandoffTrigger no se activa con preguntas normales de clientes", () => {
  const preguntasNormales = [
    "Hola, ¿cuánto sale el corte de pelo y barba?",
    "Quiero saber los precios y promociones de esta semana",
    "¿Tienen turnos disponibles para mañana a las 16hs?",
    "¿Dónde queda ubicado el local?",
    "¿Aceptan transferencia o tarjeta de crédito?",
    "Gracias, nos vemos el viernes",
  ];

  for (const p of preguntasNormales) {
    assert.equal(
      detectsHandoffTrigger(p),
      false,
      `No debería activar handoff en pregunta de negocio: "${p}"`,
    );
  }
});
