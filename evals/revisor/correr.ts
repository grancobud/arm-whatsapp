// Eval del revisor de respuestas (evaluador-optimizador, reply-review.ts).
//
// Mide al REVISOR, no al agente: le pasa borradores fijos (casos.json) con las
// mismas fuentes que tendría en producción y mira qué hace.
//   - trampa: el borrador inventa un dato o una acción. Tiene que reescribirlo
//     y la versión nueva no puede repetir lo inventado (chequeo por código).
//   - control: el borrador está bien. Tiene que dejarlo como está; cada
//     reescritura acá es un falso positivo.
// No toca la base ni manda WhatsApp.
//
// Uso: npm run eval:revisor -- --reps=2   (--modelo=auto para comparar)
// Variables: EVAL_BASE_URL (o LLM_BASE_URL), EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY).

import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext } from "../../src/features/inbox/services/business-info.ts";
import { reviewReply, type Complete, type ToolOutcome } from "../../src/features/inbox/services/reply-review.ts";
import { AHORA_FIJO, NEGOCIO } from "../agente/negocio.ts";
import { PROMPTS } from "../agente/prompts.ts";
import { exigirHuella } from "../exigir-huella.ts";

exigirHuella(import.meta.url);

interface Caso {
  id: string;
  tipo: "trampa" | "control";
  cliente: string;
  borrador: string;
  herramientas?: ToolOutcome[];
  conocimiento?: string;
  memoria?: string;
  prohibido?: string[];
  /** "nuevo" = no se parece a los ejemplos del prompt del revisor: mide si generaliza. */
  grupo?: "nuevo";
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const MODELO = args.modelo || "llama-3.3-70b-fp8-fast"; // el de producción (reviewModel)
const REPS = Number(args.reps || 2);
// En producción va una respuesta por vez: muchas juntas solo miden el límite de cupo.
const PARALELO = Number(args.paralelo || 3);

async function enTandas<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const baseURL = process.env.EVAL_BASE_URL || process.env.LLM_BASE_URL || "http://localhost:31415/v1";
const apiKey = process.env.EVAL_API_KEY || process.env.LLM_API_KEY || process.env.FREELLMAPI_KEY;
if (!apiKey) throw new Error("Falta EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY)");
const proveedor = createOpenAI({ baseURL, apiKey });

const complete: Complete = async (req) => {
  const r = await generateText({
    model: proveedor.chat(MODELO),
    system: req.system,
    prompt: req.prompt,
    temperature: req.temperature,
    maxOutputTokens: req.maxOutputTokens,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(req.timeoutMs),
  });
  return {
    text: r.text,
    finishReason: r.finishReason,
    inputTokens: r.usage?.inputTokens ?? 0,
    outputTokens: r.usage?.outputTokens ?? 0,
  };
};

const TOOL_NAMES = ["check_availability", "schedule_highlevel", "schedule_followup", "remember_fact"];
const bizContext = buildBusinessInfoContext(NEGOCIO);
const casos: Caso[] = JSON.parse(readFileSync(new URL("./casos.json", import.meta.url), "utf8"));

function agentPrompt(caso: Caso): string {
  return buildSystemPrompt({
    nowContext: AHORA_FIJO,
    bizContext,
    memoryContext: caso.memoria ? `## Lo que sabemos del cliente\n${caso.memoria}` : "",
    kbContext: caso.conocimiento ?? "",
    promptBase: PROMPTS.v3,
    toolNames: TOOL_NAMES,
    vars: { agentName: "Martín", businessName: "Barbería El Faro", contactName: "" },
  });
}

// Los casos parecidos a los ejemplos del prompt y los nuevos se cuentan aparte.
const cuenta = () => ({ trampas: 0, atrapadas: 0, limpias: 0, controles: 0, intactos: 0 });
const grupos = { ejemplos: cuenta(), nuevo: cuenta() };
let fallas = 0;
const t0 = Date.now();

for (let rep = 1; rep <= REPS; rep++) {
  const corridas = await enTandas(casos, PARALELO, async (caso) => {
      const r = await reviewReply({
        draft: caso.borrador,
        customerMessage: caso.cliente,
        agentSystemPrompt: agentPrompt(caso),
        sources: {
          business: bizContext,
          knowledge: caso.conocimiento,
          memory: caso.memoria,
          toolResults: caso.herramientas ?? [],
          toolNames: TOOL_NAMES,
        },
        complete,
      });
      return { caso, r };
  });
  for (const { caso, r } of corridas) {
    if (r.outcome === "review_failed") fallas++;
    let marca: string;
    const g = grupos[caso.grupo ?? "ejemplos"];
    if (caso.tipo === "trampa") {
      g.trampas++;
      const atrapo = r.outcome !== "approved" && r.outcome !== "review_failed";
      const sigue = (caso.prohibido ?? []).filter((p) => r.text.includes(p));
      if (atrapo) g.atrapadas++;
      if (r.text !== caso.borrador && sigue.length === 0) g.limpias++;
      marca = atrapo ? (r.text === caso.borrador ? `⚠️ atrapada, pero la corrección falló (${r.outcome})` : sigue.length ? `⚠️ atrapada, pero repite: ${sigue.join(", ")}` : "✅ atrapada y corregida") : `❌ se escapó (${r.outcome})`;
    } else {
      g.controles++;
      const ok = r.outcome === "approved" || r.outcome === "review_failed";
      if (r.outcome === "approved") g.intactos++;
      marca = ok ? (r.outcome === "approved" ? "✅ la dejó igual" : "· el revisor falló (salió igual)") : `❌ la tocó sin motivo: ${r.problems.join("; ")}`;
    }
    console.log(`[${rep}] ${caso.grupo === "nuevo" ? "*" : " "} ${caso.tipo.padEnd(7)} ${caso.id.padEnd(26)} ${marca}${r.error && args.ver ? ` [${r.outcome}: ${r.error}]` : ""}`);
    if (r.text !== caso.borrador && args.ver) console.log(`        → ${r.text.replace(/\n/g, " ")}`);
  }
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
console.log(`\nModelo: ${MODELO} · ${REPS} vuelta(s) · ${Math.round((Date.now() - t0) / 1000)} s`);
for (const [nombre, g] of Object.entries(grupos)) {
  console.log(
    `${nombre === "nuevo" ? "Casos nuevos (*)" : "Casos parecidos a los ejemplos"}: ` +
      `trampas corregidas sin repetir lo inventado ${g.limpias}/${g.trampas} (${pct(g.limpias, g.trampas)}), ` +
      `atrapadas ${g.atrapadas}/${g.trampas}, controles sin tocar ${g.intactos}/${g.controles} (${pct(g.intactos, g.controles)})`,
  );
}
console.log(`Revisor sin respuesta usable: ${fallas}`);
