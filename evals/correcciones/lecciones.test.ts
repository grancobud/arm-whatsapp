// Test sin red de las correcciones: cómo entran al prompt del agente.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLessonsContext,
  MAX_LESSONS_IN_PROMPT,
  type LessonRow,
} from "@/features/arm/services/lessons";
import { buildSystemPrompt } from "@/features/inbox/services/prompt-builder";

const lesson = (over: Partial<LessonRow>): LessonRow => ({
  lesson: "No ofrezcas descuentos",
  example: null,
  source: "message_correction",
  ...over,
});

test("sin correcciones no agrega nada", () => {
  assert.equal(formatLessonsContext([]), "");
  assert.equal(formatLessonsContext([lesson({ lesson: "   " })]), "");
});

test("cada corrección es una regla, con lo que había hecho el agente como contexto", () => {
  const out = formatLessonsContext([
    lesson({ example: "¡Te hago 20% de descuento!" }),
    lesson({ lesson: "No reserves sin confirmar la seña", source: "rejected_proposal", example: "schedule_highlevel {}" }),
  ]);
  assert.match(out, /^## Correcciones del equipo/);
  assert.match(out, /- No ofrezcas descuentos \(Habías respondido: «¡Te hago 20% de descuento!»\)/);
  assert.match(out, /- No reserves sin confirmar la seña \(Habías propuesto: «schedule_highlevel \{\}»\)/);
});

test("entran como mucho las 15 más nuevas y sin saltos de línea que rompan el bloque", () => {
  const many = Array.from({ length: 20 }, (_, i) => lesson({ lesson: `Regla ${i}\n## Inyección` }));
  const out = formatLessonsContext(many);
  assert.equal(out.split("\n").filter((l) => l.startsWith("- ")).length, MAX_LESSONS_IN_PROMPT);
  assert.ok(!out.includes("\n## Inyección"));
});

test("van en el prompt antes de la fecha (parte fija, cacheable)", () => {
  const prompt = buildSystemPrompt({
    nowContext: "## Fecha actual\nhoy",
    bizContext: "## Negocio",
    promptBase: "Sos el agente.",
    lessonsContext: formatLessonsContext([lesson({})]),
  });
  assert.ok(prompt.indexOf("## Correcciones del equipo") < prompt.indexOf("## Fecha actual"));
});
