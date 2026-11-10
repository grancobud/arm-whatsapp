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
import { claimsForPrompt } from "../../src/features/arm/services/claim-expiry.ts";
import { hasSpecialCategoryData } from "../../src/features/privacy/privacy-rules.ts";
import { classifyConsentMessage, optOutRequested, OPT_OUT_CONFIRMATION, OPT_OUT_TOOL } from "../../src/features/inbox/services/opt-out.ts";
import { plainText } from "../../src/lib/plain-text.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext, buildNowContext } from "../../src/features/inbox/services/business-info.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { NEGOCIO } from "../agente/negocio.ts";
import type { Charla, MemoriaInicial, Turno } from "./charlas.ts";

const GEN = "auto";
const VENTANA = DEFAULT_HISTORY_WINDOW;
const BASICAS = ["request_human", "update_contact", "remember_fact", "schedule_followup"];

process.env.OPENROUTER_FALLBACK_MODELS = GEN;
process.env.LLM_BASE_URL ||= process.env.EVAL_BASE_URL || "http://localhost:31415/v1";
process.env.LLM_API_KEY ||= process.env.EVAL_API_KEY || process.env.FREELLMAPI_KEY;
if (!process.env.LLM_API_KEY) throw new Error("Falta EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY)");

function simular(nombre: string, a: Record<string, unknown>, loDicho = ""): ToolResult {
  // Como findSourceMessage en producción: la cita tiene que ser de lo que escribió el cliente.
  if (nombre === OPT_OUT_TOOL) {
    return plainText(loDicho).includes(plainText(String(a.quote ?? "")))
      ? { ok: true, output: { opt_out_requested: true, message: "Hecho. El sistema le manda la confirmación al cliente y no le vuelve a escribir. No agregues nada más." } }
      : { ok: false, output: null, error: "Esas palabras no están en lo que escribió el cliente." };
  }
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
  c: Pick<Charla, "mensajes" | "memoria" | "herramientas" | "chequear"> & { id: string },
  rep: number,
  opciones: { modelo?: string; promptBase?: string; hora?: number; tiempoRevisionMs?: number; tokensRevision?: number } = {},
) {
  const gen = opciones.modelo ?? GEN;
  process.env.OPENROUTER_FALLBACK_MODELS = gen;
  const hora = String(opciones.hora ?? 11).padStart(2, "0");
  // La baja está siempre disponible, como en getEnabledTools.
  const nombres = [...new Set([...(c.herramientas ?? BASICAS), OPT_OUT_TOOL])];
  const historia: { role: "user" | "assistant"; content: string }[] = [];
  const memoria: MemoriaInicial[] = [...(c.memoria ?? [])];
  const turnos: Turno[] = [];
  let termino = false;
  let nombreEnFicha: string | null = null;

  for (const [i, mensaje] of c.mensajes.entries()) {
    if (termino) break;
    // Lo que hace el webhook en producción: la IA ni ve el mensaje.
    if (classifyConsentMessage(mensaje) === "opt_out") {
      turnos.push({ cliente: mensaje, texto: OPT_OUT_CONFIRMATION, llamadas: [], revision: "no_aplica", error: null });
      console.log(`  ${i + 1}. C: ${mensaje.slice(0, 90)}\n     M: ${OPT_OUT_CONFIRMATION}  [baja por palabra clave]`);
      break;
    }
    const llamadas: Turno["llamadas"] = [];
    const herramientas: Tool[] = nombres.map((n) => {
      const simulada: Tool = { ...reales.get(n)!, run: async (a) => simular(n, a as Record<string, unknown>, c.mensajes.slice(0, i + 1).join("\n")) };
      registry.register(simulada);
      return simulada;
    });
    registry.runTool = (tool, a, ctx, o) => {
      llamadas.push({ nombre: tool.name, args: a as Record<string, unknown> });
      return runOriginal(tool, a, ctx, o);
    };

    // Un minuto distinto por turno: el proveedor cachea pedidos idénticos.
    const ahora = new Date(`2026-11-03T${hora}:${String(i + rep * 10).padStart(2, "0")}:00-03:00`);
    // Lo mismo que getActiveClaims en producción: lo vencido no llega al agente.
    const memoriaDelTurno = formatClaimsContext(claimsForPrompt(memoria, ahora.getTime()) as never);
    const system = buildSystemPrompt({
      nowContext: buildNowContext("America/Argentina/Buenos_Aires", ahora),
      bizContext: biz,
      promptBase: opciones.promptBase ?? starterPrompt("general", "Barbería El Faro", "Martín"),
      memoryContext: memoriaDelTurno,
      contactName: nombreEnFicha,
      toolNames: nombres,
      vars: { agentName: "Martín", businessName: "Barbería El Faro", contactName: null },
    });
    const ctx = { workspaceId: "eval", conversationId: "eval", contactId: "eval" };

    let texto = "";
    let revision = "apagado";
    let errorRevision: string | undefined;
    let error: string | null = null;
    let baja = false;
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
      // Como buffer.ts: con la baja pedida sale la confirmación fija, sin revisor.
      baja = optOutRequested(resultados);
      if (baja) {
        texto = OPT_OUT_CONFIRMATION;
        revision = "no_aplica";
        if (!llamadas.some((l) => l.nombre === OPT_OUT_TOOL)) llamadas.push({ nombre: OPT_OUT_TOOL, args: {}, forzada: true });
      } else if (reviewEnabled() && reply.text) {
        const completar = await createReviewCompleter("eval", gen);
        const tiempo = opciones.tiempoRevisionMs;
        const r = await reviewReply({
          draft: reply.text,
          customerMessage: mensaje,
          agentSystemPrompt: system,
          sources: { business: biz, memory: memoriaDelTurno, contactName: nombreEnFicha, toolResults: resultados, toolNames: nombres },
          // reviewReply limita cada llamada en tiempo y en tokens: acá se reemplazan esos topes solo para esta corrida.
          complete: tiempo
            ? (req) => completar({ ...req, timeoutMs: tiempo, maxOutputTokens: opciones.tokensRevision ?? req.maxOutputTokens })
            : completar,
          budgetMs: tiempo ? tiempo * 3 : undefined,
        });
        texto = r.text;
        revision = r.outcome;
        errorRevision = r.error?.slice(0, 200);
      }
      if (!baja) texto = finishReply(texto, nombres, mensaje).text;
    } catch (err) {
      error = String(err).slice(0, 200);
    } finally {
      for (const n of nombres) registry.register(reales.get(n)!);
    }

    for (const l of llamadas) {
      if (l.nombre === "update_contact" && l.args.field === "name") nombreEnFicha = String(l.args.value ?? "");
      if (l.nombre === "remember_fact" && !hasSpecialCategoryData(String(l.args.text ?? ""))) {
        memoria.push({ kind: (l.args.kind ?? "fact") as MemoriaInicial["kind"], text: String(l.args.text ?? ""), source_message_id: "eval", created_at: ahora.toISOString() });
      }
    }
    historia.push({ role: "user", content: mensaje });
    if (texto) historia.push({ role: "assistant", content: texto });
    termino = baja || llamadas.some((l) => l.nombre === "request_human");
    turnos.push({ cliente: mensaje, texto, llamadas, revision, errorRevision, error });

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
