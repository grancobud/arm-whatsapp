// Un modelo colgado no puede comerse el turno: se corta a tiempo y pasa al siguiente.
// Sin red: el "proveedor" es un servidor local.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  MODEL_CALL_TIMEOUT_MS,
  RESERVE_TO_SEND_MS,
  modelCallTimeoutMs,
} from "../../src/features/inbox/services/model-chain.ts";
import { checkReply } from "../../src/features/inbox/services/reply-guard.ts";

test("el tope por modelo respeta el plazo del turno", () => {
  const ahora = 1_000_000;
  assert.equal(modelCallTimeoutMs(undefined, ahora), MODEL_CALL_TIMEOUT_MS);
  assert.equal(modelCallTimeoutMs(ahora + 60_000, ahora), MODEL_CALL_TIMEOUT_MS);
  assert.equal(modelCallTimeoutMs(ahora + RESERVE_TO_SEND_MS + 5_000, ahora), 5_000);
  assert.equal(modelCallTimeoutMs(ahora, ahora), 1_000, "sin tiempo igual prueba una vez, corta");
});

test("frena palabras en inglés que salieron en respuestas reales", () => {
  assert.equal(checkReply("¡Hola! Para sacar turnover, te paso con una persona.").reason, "mixed_language");
  assert.equal(checkReply("Te ayudo a coordinator el turno.").reason, "mixed_language");
  assert.equal(checkReply("Perfecto, te escribo el viernes a la morning.").reason, "mixed_language");
  assert.equal(checkReply("I’m sorry, but I can’t comply with that.").reason, "mixed_language");
  assert.equal(checkReply("Te paso con una persona para coordinar el turno.").ok, true);
  assert.equal(checkReply("Podés ver nuestro Instagram o reservar por WhatsApp.").ok, true);
});

test("si un modelo se cuelga, se corta y responde el siguiente", async () => {
  const modelos: string[] = [];
  const llegadas: number[] = [];
  const servidor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      const { model } = JSON.parse(cuerpo) as { model: string };
      modelos.push(model);
      llegadas.push(Date.now());
      if (model === "colgado") return; // nunca responde
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 1,
          model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hola, ¿en qué te ayudo?" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "test";
  process.env.OPENROUTER_FALLBACK_MODELS = "colgado,sano";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";

  const { generateWithTools } = await import("../../src/features/inbox/services/openrouter.ts");
  try {
    const r = await generateWithTools({
      systemPrompt: "Sos un asistente.",
      model: "colgado",
      userMessage: "hola",
      workspaceId: "test",
      toolContext: { workspaceId: "test", conversationId: "test", contactId: "test" },
      // Le deja 400 ms al primero, sin contar lo que se reserva para enviar.
      deadlineAt: Date.now() + RESERVE_TO_SEND_MS + 400,
    });
    assert.equal(r.text, "Hola, ¿en qué te ayudo?");
    assert.deepEqual(modelos, ["colgado", "sano"]);
    assert.ok(llegadas[1] - llegadas[0] < 3_000, `el corte tardó ${llegadas[1] - llegadas[0]} ms`);
  } finally {
    servidor.closeAllConnections();
    servidor.close();
  }
});
