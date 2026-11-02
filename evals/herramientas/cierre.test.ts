// Test sin red de generateWithTools: un servidor local imita a un proveedor
// compatible con OpenAI que pide una herramienta y después no escribe nada.
// El cliente igual tiene que recibir texto (llamada de cierre sin herramientas).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const pedidos: { tools: boolean; ultimo: string }[] = [];

function respuesta(message: Record<string, unknown>, finish: string) {
  return {
    id: "x", object: "chat.completion", created: 0, model: "falso",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

const servidor = createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", () => {
    const j = JSON.parse(cuerpo);
    pedidos.push({ tools: Array.isArray(j.tools) && j.tools.length > 0, ultimo: j.messages.at(-1)?.role });
    const n = pedidos.length;
    const out =
      n === 1
        ? respuesta({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "remember_fact", arguments: JSON.stringify({ kind: "need", text: "Corte para el casamiento", quote: "es para el casamiento" }) } }] }, "tool_calls")
        : n === 2
          ? respuesta({ content: "" }, "stop") // usó la herramienta y no escribió nada
          : respuesta({ content: "¡Genial! ¿Qué día te queda bien?" }, "stop");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
});

test("después de usar herramientas, el cliente siempre recibe texto", async () => {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "test";
  process.env.OPENROUTER_FALLBACK_MODELS = "falso";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";

  const { generateWithTools } = await import("../../src/features/inbox/services/openrouter.ts");
  const { registry } = await import("../../src/features/tools/index.ts");
  const real = registry.get("remember_fact")!;
  const simulada = { ...real, run: async () => ({ ok: true, output: { saved: true } }) };
  registry.register(simulada);

  try {
    const r = await generateWithTools({
      systemPrompt: "Sos un asistente.",
      model: "falso",
      userMessage: "es para el casamiento",
      workspaceId: "test",
      availableTools: [simulada],
      toolContext: { workspaceId: "test", conversationId: "test", contactId: "test" },
    });
    assert.equal(r.text, "¡Genial! ¿Qué día te queda bien?");
    assert.equal(pedidos.length, 3);
    assert.equal(pedidos[2].tools, false, "la llamada de cierre va sin herramientas");
    assert.equal(pedidos[2].ultimo, "tool", "la llamada de cierre incluye el resultado de la herramienta");
    assert.equal(r.inputTokens, 30, "suma los tokens de las tres llamadas");
  } finally {
    registry.register(real);
    servidor.close();
  }
});
