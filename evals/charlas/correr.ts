// Examen de conversaciones largas: lo que eval:produccion no ve, porque manda un solo
// mensaje por caso. Cada charla pasa turno por turno por los mismos pasos que buffer.ts,
// con la misma ventana de historial (10 mensajes) y la memoria armada con lo que el
// agente guardó. Si buffer.ts suma un paso, va también acá.
//
// Las herramientas son las reales con la ejecución simulada. Después de un traspaso la
// charla termina, como en producción: la IA deja de responder.
//
//   npm run eval:charlas [-- --reps=1] [-- --caso=id]

import { mkdirSync, writeFileSync } from "node:fs";
import { generateWithTools, createReviewCompleter } from "../../src/features/inbox/services/openrouter.ts";
import { backHandoffPromise, withHandoffNotice } from "../../src/features/inbox/services/handoff-promise.ts";
import { backContactData } from "../../src/features/inbox/services/contact-capture.ts";
import { finishReply } from "../../src/features/inbox/services/reply-finish.ts";
import { reviewEnabled, reviewReply, type ToolOutcome } from "../../src/features/inbox/services/reply-review.ts";
import { registry } from "../../src/features/tools/index.ts";
import type { Tool, ToolResult } from "../../src/features/tools/core/tool.ts";
import { invalidContactValue } from "../../src/features/arm/services/contact-update-rules.ts";
import { formatClaimsContext } from "../../src/features/arm/services/claims.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext, buildNowContext } from "../../src/features/inbox/services/business-info.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { NEGOCIO } from "../agente/negocio.ts";
import { exigirHuella } from "../exigir-huella.ts";
import { CHARLAS, type Turno } from "./charlas.ts";

exigirHuella(import.meta.url);

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const GEN = "auto";
const REPS = Number(argumentos.reps ?? 1);
const VENTANA = 10;
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

async function correrCharla(c: (typeof CHARLAS)[number], rep: number) {
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
      nowContext: buildNowContext("America/Argentina/Buenos_Aires", new Date(`2026-11-03T11:${String(i + rep * 10).padStart(2, "0")}:00-03:00`)),
      bizContext: biz,
      promptBase: starterPrompt("general", "Barbería El Faro", "Martín"),
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
        model: GEN,
        userMessage: mensaje,
        workspaceId: "eval",
        availableTools: herramientas,
        toolContext: ctx,
        history: historia.slice(-VENTANA),
      });
      const resultados: ToolOutcome[] = [...reply.toolResults];
      const forzado = await backHandoffPromise({ text: reply.text, tools: herramientas, results: resultados, ctx, customerText: mensaje });
      if (forzado) {
        resultados.push(forzado);
        llamadas.push({ nombre: "request_human", args: {}, forzada: true });
        if (forzado.status === "ok") reply.text = withHandoffNotice(reply.text);
      }
      for (const d of await backContactData({ customerText: mensaje, tools: herramientas, results: resultados, ctx })) {
        resultados.push(d);
        llamadas.push({ nombre: "update_contact", args: d.args ?? {}, forzada: true });
      }
      texto = reply.text;
      if (reviewEnabled() && reply.text) {
        const r = await reviewReply({
          draft: reply.text,
          customerMessage: mensaje,
          agentSystemPrompt: system,
          sources: { business: biz, memory: formatClaimsContext(memoria as never), toolResults: resultados, toolNames: nombres },
          complete: await createReviewCompleter("eval", GEN),
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
      if (l.nombre === "remember_fact") {
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

// La bitácora de herramientas no tiene base acá: su aviso tapa las charlas.
const errorOriginal = console.error;
console.error = (...a: unknown[]) => {
  if (!String(a[0]).includes("logToolCall failed")) errorOriginal(...a);
};

const elegidas = CHARLAS.filter((c) => !argumentos.caso || argumentos.caso === c.id);
const resultados: Awaited<ReturnType<typeof correrCharla>>[] = [];
for (const c of elegidas) {
  for (let rep = 1; rep <= REPS; rep++) {
    console.log(`\n── ${c.id} #${rep}: ${c.objetivo}`);
    const r = await correrCharla(c, rep);
    resultados.push(r);
    for (const x of r.chequeos.filter((y) => !y.ok)) console.log(`  ❌ ${x.nombre}${x.detalle ? `: ${String(x.detalle).slice(0, 160)}` : ""}`);
    if (resultados.length === 2 && resultados.every((y) => y.turnos.every((t) => t.error))) {
      console.error("\nLas primeras charlas fallaron enteras: es la configuración o el cupo.");
      process.exit(1);
    }
  }
}

const todos = resultados.flatMap((r) => r.chequeos);
const turnos = resultados.flatMap((r) => r.turnos);
console.log("\n=== Resumen ===");
console.log(`Chequeos: ${todos.filter((c) => c.ok).length}/${todos.length}`);
console.log(`Turnos: ${turnos.length} · con error ${turnos.filter((t) => t.error).length} · sin revisar ${turnos.filter((t) => ["review_failed", "rewrite_failed"].includes(t.revision)).length}`);
for (const r of resultados) {
  const mal = r.chequeos.filter((c) => !c.ok).map((c) => c.nombre).join(", ");
  console.log(`  ${`${r.id} #${r.rep}`.padEnd(32)} ${r.chequeos.filter((c) => c.ok).length}/${r.chequeos.length}${mal ? `  ❌ ${mal}` : ""}`);
}
mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./resultados/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url), JSON.stringify(resultados, null, 2));
