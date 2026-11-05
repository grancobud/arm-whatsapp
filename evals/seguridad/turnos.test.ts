import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  approvalFollowUp,
  blocksRetry,
  capInbound,
  formatPendingActions,
  isRunningElsewhere,
  MAX_INBOUND_CHARS,
  MAX_TURN_ATTEMPTS,
  turnRecovery,
} from "../../src/features/inbox/services/turn-recovery.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";

test("un turno que ya mandó la respuesta no se repite", () => {
  assert.equal(turnRecovery({ reply_sent: true, side_effects: true, attempts: 9 }), "finish");
});

test("un turno cortado después de una herramienta pasa a una persona", () => {
  assert.equal(turnRecovery({ side_effects: true, attempts: 1 }), "hand_to_person");
});

test("un turno cortado al enviar no se repite: la respuesta pudo haber llegado", () => {
  assert.equal(turnRecovery({ send_started: true, attempts: 1 }), "hand_to_person");
  assert.equal(turnRecovery({ send_started: true, reply_sent: true, attempts: 1 }), "finish");
});

test("sin nada hecho reintenta, con un tope que cuenta las corridas que murieron", () => {
  assert.equal(turnRecovery({ attempts: 1 }), "retry");
  assert.equal(turnRecovery({ attempts: MAX_TURN_ATTEMPTS - 1 }), "retry");
  assert.equal(turnRecovery({ attempts: MAX_TURN_ATTEMPTS }), "give_up");
});

test("qué herramientas impiden reintentar", () => {
  assert.equal(blocksRetry({ name: "schedule_highlevel", sensitivity: "write" }), true);
  assert.equal(blocksRetry({ name: "custom_webhook", sensitivity: "sensitive" }), true);
  assert.equal(blocksRetry({ name: "check_availability", sensitivity: "read" }), false);
  assert.equal(blocksRetry({ name: "remember_fact", sensitivity: "write" }), false);
});

test("un mensaje gigante se corta y lo avisa", () => {
  assert.equal(capInbound("hola"), "hola");
  const largo = capInbound("x".repeat(MAX_INBOUND_CHARS + 500));
  assert.ok(largo.length < MAX_INBOUND_CHARS + 100);
  assert.match(largo, /se cortó/);
});

test("otro lote en curso cuenta solo mientras no esté muerto", () => {
  const ahora = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(isRunningElsewhere("2026-11-04T11:59:00Z", ahora), true);
  assert.equal(isRunningElsewhere("2026-11-04T11:54:00Z", ahora), false);
});

test("la decisión en Revisión se cierra con el cliente", () => {
  assert.ok(approvalFollowUp("done", "ai_active").message);
  assert.deepEqual(approvalFollowUp("rejected", "ai_active"), { handoff: true });
  assert.deepEqual(approvalFollowUp("failed", "ai_active"), { handoff: true });
  assert.deepEqual(approvalFollowUp("done", "human_active"), {}, "si ya está una persona, responde ella");
  assert.deepEqual(approvalFollowUp("rejected", "paused"), {});
});

test("el agente sabe lo que espera aprobación", () => {
  assert.equal(formatPendingActions([]), "");
  const bloque = formatPendingActions([{ tool_name: "custom_webhook", args: { note: "x" } }]);
  const out = buildSystemPrompt({ nowContext: "hoy", bizContext: "negocio", promptBase: "base", pendingActions: bloque });
  assert.match(out, /Pendiente de aprobación/);
  assert.match(out, /custom_webhook/);
});

test("avisa antes de correr una herramienta que no se puede repetir, y el error no la repite", async () => {
  let pedidos = 0;
  const servidor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      pedidos++;
      const llamada = { id: "c1", type: "function", function: { name: "schedule_followup", arguments: JSON.stringify({ due_at: "2026-11-06T10:00:00-03:00", message: "Hola, te escribo como quedamos" }) } };
      const mensaje = pedidos === 1 ? { role: "assistant", content: null, tool_calls: [llamada] } : { role: "assistant", content: "Listo, te escr" };
      const fin = pedidos === 1 ? "tool_calls" : "length"; // después de la herramienta, texto cortado
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "falso", choices: [{ index: 0, message: mensaje, finish_reason: fin }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "test";
  process.env.OPENROUTER_FALLBACK_MODELS = "falso,otro";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";

  const { generateWithTools } = await import("../../src/features/inbox/services/openrouter.ts");
  const { registry } = await import("../../src/features/tools/index.ts");
  const real = registry.get("schedule_followup")!;
  let corridas = 0;
  const simulada = { ...real, run: async () => { corridas++; return { ok: true, output: { scheduled: true } }; } };
  registry.register(simulada);
  let avisos = 0;
  try {
    await assert.rejects(
      generateWithTools({
        systemPrompt: "Sos un asistente.",
        model: "falso",
        userMessage: "escribime el viernes",
        workspaceId: "test",
        availableTools: [simulada],
        toolContext: { workspaceId: "test", conversationId: "test", contactId: "test" },
        onSideEffect: async () => {
          avisos++;
          assert.equal(corridas, 0, "avisa antes de ejecutarla");
        },
      }),
    );
    assert.equal(avisos, 1);
    assert.equal(corridas, 1, "otro modelo no la vuelve a ejecutar");
  } finally {
    registry.register(real);
    servidor.close();
  }
});
