// Un turno de conversación con los mismos pasos que buffer.ts. Lo usan eval:charlas y eval:sesgos.
// Si buffer.ts suma un paso, va también acá.

import { generateWithTools, createReviewCompleter } from "../../src/features/inbox/services/openrouter.ts";
import { applyTurnGuards } from "../../src/features/inbox/services/turn-guards.ts";
import { DEFAULT_HISTORY_WINDOW } from "../../src/features/inbox/services/conversation-history.ts";
import { finishReply } from "../../src/features/inbox/services/reply-finish.ts";
import { reviewEnabled, reviewReply, type ToolOutcome } from "../../src/features/inbox/services/reply-review.ts";
import { registry } from "../../src/features/tools/index.ts";
import type { Tool, ToolResult } from "../../src/features/tools/core/tool.ts";
import { invalidContactValue } from "../../src/features/arm/services/contact-update-rules.ts";
import { formatClaimsContext } from "../../src/features/arm/services/claims.ts";
import { hasSpecialCategoryData } from "../../src/features/privacy/privacy-rules.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext, buildNowContext } from "../../src/features/inbox/services/business-info.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { NEGOCIO } from "../agente/negocio.ts";
import type { Charla, Turno } from "./charlas.ts";

const GEN = "auto";
const VENTANA = DEFAULT_HISTORY_WINDOW;
const BASICAS = ["request_human", "update_contact", "remember_fact", "schedule_followup"];

process.env.OPENROUTER_FALLBACK_MODELS = GEN;
process.env.LLM_BASE_URL ||= process.env.EVAL_BASE_URL || "http://localhost:31415/v1";
process.env.LLM_API_KEY ||= process.env.EVAL_API_KEY || process.env.FREELLMAPI_KEY;
if (!process.env.LLM_API_KEY) throw new Error("Falta EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY)");

function simular(nombre: string, a: Record<string, unknown>): ToolResult {
  if (nombre === "request_human") {
    return {
      ok: true,
      output: {
        handed_over: true,
        message: "Hecho. Nota interna, no se la copies al cliente: respondele con tus palabras, en una oración, que una persona del equipo lo va a atender. Si le pasó algo malo, pedí disculpas. No prometas cuándo.",
      },
    };
  }
  if (nombre === "update_contact") {
    const invalido = invalidContactValue(a.field as "name" | "email", String(a.value ?? ""), String(a.quote ?? ""));
    return invalido ? { ok: false, output: null, error: invalido } : { ok: true, output: { saved: true, field: a.field } };
  }
  if (nombre === "remember_fact" && hasSpecialCategoryData(String(a.text ?? ""))) {
    return { ok: false, output: null, error: "No se guardan datos de salud, religión, política ni vida sexual en la memoria." };
  }
  if (nombre === "check_availability") {
    return JSON.stringify(a).includes("2026-11-06")
      ? { ok: true, output: { slots: ["2026-11-06T15:00:00-03:00", "2026-11-06T17:30:00-03:00"], count: 2, message: "Hay 2 horarios disponibles." } }
      : { ok: true, output: { slots: [], count: 0, message: "No hay horarios disponibles en esas fechas." } };
  }
  return { ok: true, output: { saved: true } };
}

const reales = new Map(registry.list().map((t) => [t.name, t]));
const runOriginal = registry.runTool.bind(registry);
const biz = buildBusinessInfoContext(NEGOCIO);

export async function correrCharla(
  c: Pick<Charla, "mensajes" | "herramientas" | "chequear"> & { id: string },
  rep: number,
  opciones: { modelo?: string; promptBase?: string; hora?: number } = {},
) {
  const gen = opciones.modelo ?? GEN;
  process.env.OPENROUTER_FALLBACK_MODELS = gen;
  const hora = String(opciones.hora ?? 11).padStart(2, "0");
  const nombres = c.herramientas ?? BASICAS;
  const historia: { role: "user" | "assistant"; content: string }[] = [];
  const memoria: { kind: string; text: string; source_message_id: string | null }[] = [];
  const turnos: Turno[] = [];
  let traspaso = false;
  let nombreEnFicha: string | null = null;

  for (const [i, mensaje] of c.mensajes.entries()) {
    if (traspaso) break;
    const llamadas: Turno["llamadas"] = [];
    const herramientas: Tool[] = nombres.map((n) => {
      const simulada: Tool = { ...reales.get(n)!, run: async (a) => simular(n, a as Record<string, unknown>) };
      registry.register(simulada);
      return simulada;
    });
    registry.runTool = (tool, a, ctx, o) => {
      llamadas.push({ nombre: tool.name, args: a as Record<string, unknown> });
      return runOriginal(tool, a, ctx, o);
    };

    const system = buildSystemPrompt({
      // Un minuto distinto por turno: el proveedor cachea pedidos idénticos.
      nowContext: buildNowContext("America/Argentina/Buenos_Aires", new Date(`2026-11-03T${hora}:${String(i + rep * 10).padStart(2, "0")}:00-03:00`)),
      bizContext: biz,
      promptBase: opciones.promptBase ?? starterPrompt("general", "Barbería El Faro", "Martín"),
      memoryContext: formatClaimsContext(memoria as never),
      contactName: nombreEnFicha,
      toolNames: nombres,
      vars: { agentName: "Martín", businessName: "Barbería El Faro", contactName: null },
    });
    const ctx = { workspaceId: "eval", conversationId: "eval", contactId: "eval" };

    let texto = "";
    let revision = "apagado";
    let error: string | null = null;
    try {
      const reply = await generateWithTools({
        systemPrompt: system,
        model: gen,
        userMessage: mensaje,
        workspaceId: "eval",
        availableTools: herramientas,
        toolContext: ctx,
        history: historia.slice(-VENTANA),
      });
      const resultados: ToolOutcome[] = [...reply.toolResults];
      const guardias = await applyTurnGuards({ text: reply.text, customerText: mensaje, tools: herramientas, results: resultados, ctx });
      reply.text = guardias.text;
      if (guardias.forcedHandoff) llamadas.push({ nombre: "request_human", args: {}, forzada: true });
      for (const d of guardias.savedContactData) llamadas.push({ nombre: "update_contact", args: d.args ?? {}, forzada: true });
      texto = reply.text;
      if (reviewEnabled() && reply.text) {
        const r = await reviewReply({
          draft: reply.text,
          customerMessage: mensaje,
          agentSystemPrompt: system,
          sources: { business: biz, memory: formatClaimsContext(memoria as never), contactName: nombreEnFicha, toolResults: resultados, toolNames: nombres },
          complete: await createReviewCompleter("eval", gen),
        });
        texto = r.text;
        revision = r.outcome;
      }
      texto = finishReply(texto, nombres, mensaje).text;
    } catch (err) {
      error = String(err).slice(0, 200);
    } finally {
      for (const n of nombres) registry.register(reales.get(n)!);
    }

    for (const l of llamadas) {
      if (l.nombre === "update_contact" && l.args.field === "name") nombreEnFicha = String(l.args.value ?? "");
      if (l.nombre === "remember_fact" && !hasSpecialCategoryData(String(l.args.text ?? ""))) {
        memoria.push({ kind: String(l.args.kind ?? "fact"), text: String(l.args.text ?? ""), source_message_id: "eval" });
      }
    }
    historia.push({ role: "user", content: mensaje });
    if (texto) historia.push({ role: "assistant", content: texto });
    traspaso = llamadas.some((l) => l.nombre === "request_human");
    turnos.push({ cliente: mensaje, texto, llamadas, revision, error });

    const usadas = llamadas.map((l) => l.nombre + (l.forzada ? "*" : "")).join(",");
    console.log(`  ${i + 1}. C: ${mensaje.slice(0, 90)}`);
    console.log(`     M: ${texto.replace(/\n/g, " ").slice(0, 240) || `(${error ?? "vacía"})`}${usadas ? `  [${usadas}]` : ""}${revision !== "approved" ? ` {${revision}}` : ""}`);
  }
  return { id: c.id, rep, turnos, chequeos: c.chequear(turnos) };
}

// La bitácora de herramientas no tiene base acá: su aviso tapa las respuestas.
const errorOriginal = console.error;
console.error = (...a: unknown[]) => {
  if (!String(a[0]).includes("logToolCall failed")) errorOriginal(...a);
};
