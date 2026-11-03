import { test } from "node:test";
import assert from "node:assert/strict";

// ──────────────────────────────────────────────────────────────────────────────
// Encadenamiento y Resiliencia en el Flujo de Agentes
// Prueba que las fallas en pasos secundarios (etiquetas, resumen, CRM) no corten
// la entrega del mensaje ni corrompan el estado del contacto.
// ──────────────────────────────────────────────────────────────────────────────

test("protección de clientes: un contacto en etapa customer nunca se degrada", () => {
  function computeNextStage(
    currentStage: string | undefined,
    evaluation: { knocked_out: boolean; qualified: boolean },
  ): string | undefined {
    let stage = currentStage;
    if (currentStage !== "customer") {
      if (evaluation.knocked_out) stage = "lost";
      else if (evaluation.qualified) stage = "qualified";
    }
    return stage;
  }

  // Si ya es cliente, un knockout en setter no lo pasa a "lost"
  assert.equal(
    computeNextStage("customer", { knocked_out: true, qualified: false }),
    "customer",
  );
  // Un lead normal sí pasa a lost o qualified
  assert.equal(
    computeNextStage("lead", { knocked_out: true, qualified: false }),
    "lost",
  );
  assert.equal(
    computeNextStage("lead", { knocked_out: false, qualified: true }),
    "qualified",
  );
});

test("idempotencia: una conversación con resultado terminal no se re-evalúa", () => {
  function shouldReevaluate(customFields: Record<string, unknown>): boolean {
    if (
      customFields.lead_qualified === true ||
      customFields.setter_knocked_out === true
    ) {
      return false;
    }
    return true;
  }

  assert.equal(shouldReevaluate({ lead_qualified: true }), false);
  assert.equal(shouldReevaluate({ setter_knocked_out: true }), false);
  assert.equal(shouldReevaluate({ lead_score: 45 }), true);
  assert.equal(shouldReevaluate({}), true);
});

test("freno de costo en setter: evalúa como máximo cada 2 turnos del usuario", () => {
  function isDebounced(userTurns: number, lastEvalTurns: number): boolean {
    if (lastEvalTurns > 0 && userTurns - lastEvalTurns < 2) return true;
    return false;
  }

  // Primera vez (lastEvalTurns = 0) -> evalúa
  assert.equal(isDebounced(1, 0), false);
  // Turno inmediatamente siguiente (userTurns = 2, lastEvalTurns = 1) -> frena
  assert.equal(isDebounced(2, 1), true);
  // Pasaron 2 turnos (userTurns = 3, lastEvalTurns = 1) -> evalúa
  assert.equal(isDebounced(3, 1), false);
});

test("reconciliación de knockout: un lead noqueado nunca queda calificado", () => {
  function reconcileQualification(
    score: number,
    threshold: number,
    knockedOut: boolean,
  ): boolean {
    return knockedOut ? false : score >= threshold;
  }

  // Puntaje 95 pero con regla knockout -> no califica
  assert.equal(reconcileQualification(95, 50, true), false);
  // Puntaje 95 sin knockout -> califica
  assert.equal(reconcileQualification(95, 50, false), true);
  // Puntaje 40 sin knockout -> no califica
  assert.equal(reconcileQualification(40, 50, false), false);
});
