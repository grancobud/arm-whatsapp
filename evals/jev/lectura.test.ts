// Test sin red del Jev gratis: cómo se lee la respuesta del modelo, incluso
// cuando viene con razonamiento, bloques de código o números fuera de rango.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFreeJudgment } from "@/features/jev-judge/free-judge";
import { estimateCostUsd } from "@/features/jev-judge/cost";

test("lee un JSON limpio", () => {
  assert.deepEqual(parseFreeJudgment('{"action":"respond","confidence":0.9,"intent":1,"auto_reply":0.8,"opt_out":0}'), {
    action: "respond",
    actionConfidence: 0.9,
    intentScore: 1,
    autoReplyProbability: 0.8,
    optOutProbability: 0,
  });
});

test("toma el último JSON aunque antes haya razonamiento o un ejemplo", () => {
  const text =
    'Pienso... el ejemplo era {"action":"respond","confidence":1} pero acá pide baja.\n```json\n{"action":"abstain","confidence":0.8,"intent":0,"auto_reply":0,"opt_out":0.95}\n```';
  const j = parseFreeJudgment(text);
  assert.equal(j?.action, "abstain");
  assert.equal(j?.optOutProbability, 0.95);
});

test("números raros quedan dentro de rango y lo que falta va al lado seguro", () => {
  const j = parseFreeJudgment('{"action":"HANDOFF","confidence":7,"intent":"5","auto_reply":-1}');
  assert.deepEqual(j, {
    action: "handoff",
    actionConfidence: 1,
    intentScore: 2,
    autoReplyProbability: 0,
    optOutProbability: 0,
  });
});

test("sin JSON o con una acción desconocida no decide nada", () => {
  assert.equal(parseFreeJudgment("no sé"), null);
  assert.equal(parseFreeJudgment('{"action":"comprar"}'), null);
  assert.equal(parseFreeJudgment('{"action": "respond",'), null);
});

test("el Jev gratis no suma costo", () => {
  assert.equal(estimateCostUsd(1_000_000, "freellmapi/openai/gpt-oss-20b"), 0);
  assert.ok(estimateCostUsd(1_000_000, "jev-latest") > 0);
});
