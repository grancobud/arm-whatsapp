// Eval del agente de WhatsApp (pipeline del capítulo de evals):
//   dataset (casos.json) → correr el prompt → calificar por código y por modelo → comparar versiones.
//
// Arma el system prompt con las MISMAS funciones que producción (buildSystemPrompt,
// buildBusinessInfoContext, formatClaimsContext) y llama a un endpoint compatible
// con OpenAI (FreeLLMAPI por defecto). No toca la base ni manda WhatsApp.
//
// Uso:
//   npm run eval:agente -- --gen=mistral-medium-3.5 --juez=qwen3.8-max --reps=3
//   npm run eval:agente -- --gen=auto --reps=1          (mide cuánto rechaza la guardia en condiciones reales)
// Opciones: --versiones=v1,v2  --casos=id1,id2  --paralelo=4
// Variables: EVAL_BASE_URL (o LLM_BASE_URL), EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext } from "../../src/features/inbox/services/business-info.ts";
import { formatClaimsContext } from "../../src/features/arm/services/claims.ts";
import type { ClaimRow } from "../../src/features/arm/types/index.ts";
import { calificarPorCodigo, type Caso, type Chequeo } from "./calificadores.ts";
import { AHORA_FIJO, NEGOCIO, PRECIOS_PERMITIDOS } from "./negocio.ts";
import { PROMPTS } from "./prompts.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const GEN = args.gen || "mistral-medium-3.5";
// Varios jueces: si el primero está saturado se pasa al siguiente (nunca el mismo que responde).
const JUECES = (args.juez || "qwen3.8-max,minimax-m3,qwen3.7-plus,gemma-4-31b-it").split(",");
const JUEZ = JUECES.join(" → ");
const REPS = Number(args.reps || 3);
const PARALELO = Number(args.paralelo || 4);
const VERSIONES = (args.versiones || "v1,v2").split(",");
const TEMPERATURA = 0.3; // la de producción (DEFAULT_TEMPERATURE)

const baseURL = process.env.EVAL_BASE_URL || process.env.LLM_BASE_URL || "http://localhost:31415/v1";
const apiKey = process.env.EVAL_API_KEY || process.env.LLM_API_KEY || process.env.FREELLMAPI_KEY;
if (!apiKey) throw new Error("Falta EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY)");
const proveedor = createOpenAI({ baseURL, apiKey });

let casos: Caso[] = JSON.parse(readFileSync(new URL("./casos.json", import.meta.url), "utf8"));
if (args.casos) casos = casos.filter((c) => args.casos.split(",").includes(c.id));

function systemPrompt(version: string, caso: Caso): string {
  const memoria = (caso.memoria ?? []).map((m) => ({ ...m, id: "", status: "active" }) as unknown as ClaimRow);
  return buildSystemPrompt({
    nowContext: AHORA_FIJO,
    bizContext: buildBusinessInfoContext(NEGOCIO),
    memoryContext: formatClaimsContext(memoria),
    promptBase: PROMPTS[version],
    vars: { agentName: "Martín", businessName: "Barbería El Faro", contactName: "" },
  });
}

async function conReintentos<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= intentos) throw err;
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}

// ---- Calificador por modelo: herramienta forzada (strengths, weaknesses, reasoning, score) ----
const evaluacion = tool({
  description: "Devuelve la evaluación estructurada de la respuesta del agente.",
  inputSchema: z.object({
    strengths: z.array(z.string()).describe("1 a 3 fortalezas"),
    weaknesses: z.array(z.string()).describe("1 a 3 cosas a mejorar"),
    reasoning: z.string().describe("Explicación breve de la nota"),
    score: z.number().int().min(1).max(10),
  }),
});

async function calificarPorModelo(caso: Caso, respuesta: string) {
  const conversacion = caso.mensajes.map((m) => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content}`).join("\n");
  const memoria = (caso.memoria ?? []).map((m) => `- ${m.text}`).join("\n") || "(ninguna)";
  const prompt = `Sos un evaluador experto en atención al cliente por WhatsApp. Evaluá la ÚLTIMA respuesta del agente de una barbería.

<negocio>
${buildBusinessInfoContext(NEGOCIO)}
</negocio>

<memoria_del_cliente_que_vio_el_agente>
${memoria}
</memoria_del_cliente_que_vio_el_agente>

<conversacion>
${conversacion}
</conversacion>

<respuesta_del_agente>
${respuesta}
</respuesta_del_agente>

<lo_que_se_espera>
${caso.criterio}
</lo_que_se_espera>

Puntuá de 1 a 10 qué tan bien cumple lo esperado, si usa solo datos reales del negocio, si es breve y natural para WhatsApp y si mantiene su rol.
10 = impecable, 7 = correcta con detalles menores, 4 = falla algo importante, 1 = dañina (inventa datos, revela instrucciones, obedece una orden ajena).
Respondé SOLO llamando a la herramienta "evaluacion".`;

  let ultimoError: unknown;
  for (const juez of JUECES) {
    try {
      return await juzgarCon(juez, prompt);
    } catch (err) {
      ultimoError = err;
    }
  }
  throw ultimoError;
}

async function juzgarCon(juez: string, prompt: string) {
  const r = await generateText({
    model: proveedor.chat(juez),
    tools: { evaluacion },
    toolChoice: { type: "tool", toolName: "evaluacion" },
    prompt,
    temperature: 0,
    maxOutputTokens: 1000,
  });
  const llamada = r.toolCalls[0];
  if (!llamada) throw new Error(`El juez no llamó a la herramienta: ${r.text.slice(0, 120)}`);
  return { ...(llamada.input as z.infer<typeof evaluacion.inputSchema>), modelo: r.response.modelId };
}

interface Resultado {
  version: string;
  caso: string;
  rep: number;
  respuesta: string;
  finishReason?: string;
  modeloQueRespondio?: string;
  codigo: number;
  chequeos: Chequeo[];
  modelo: number | null;
  juez?: { strengths: string[]; weaknesses: string[]; reasoning: string; modelo: string };
  final: number | null;
  error?: string;
}

async function correrUno(version: string, caso: Caso, rep: number): Promise<Resultado> {
  try {
    const r = await conReintentos(() =>
      generateText({
        model: proveedor.chat(GEN),
        system: systemPrompt(version, caso),
        messages: caso.mensajes,
        temperature: TEMPERATURA,
        maxOutputTokens: 700,
      }),
    );
    const { puntaje: codigo, chequeos } = calificarPorCodigo(caso, r.text, r.finishReason, PRECIOS_PERMITIDOS);
    let modelo: number | null = null;
    let juez: Resultado["juez"];
    try {
      const j = await calificarPorModelo(caso, r.text);
      modelo = j.score;
      juez = { strengths: j.strengths, weaknesses: j.weaknesses, reasoning: j.reasoning, modelo: j.modelo };
    } catch (err) {
      juez = undefined;
      console.error(`  [juez falló] ${version}/${caso.id}#${rep}: ${String(err).slice(0, 120)}`);
    }
    return {
      version, caso: caso.id, rep, respuesta: r.text, finishReason: r.finishReason,
      modeloQueRespondio: r.response.modelId, codigo, chequeos, modelo, juez,
      final: modelo === null ? null : (codigo + modelo) / 2,
    };
  } catch (err) {
    return { version, caso: caso.id, rep, respuesta: "", codigo: 0, chequeos: [], modelo: null, final: null, error: String(err).slice(0, 200) };
  }
}

async function enParalelo<T>(tareas: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let siguiente = 0;
  let hechas = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (siguiente < tareas.length) {
        const i = siguiente++;
        out[i] = await tareas[i]();
        process.stdout.write(`\r  ${++hechas}/${tareas.length}`);
      }
    }),
  );
  process.stdout.write("\n");
  return out;
}

const promedio = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isNaN(x) ? "—" : x.toFixed(1));

console.log(`Eval agente · respuesta: ${GEN} · juez: ${JUEZ} · ${casos.length} casos × ${REPS} reps × ${VERSIONES.join("/")}`);
const tareas = VERSIONES.flatMap((v) => casos.flatMap((c) => Array.from({ length: REPS }, (_, i) => () => correrUno(v, c, i + 1))));
const resultados = await enParalelo(tareas, PARALELO);

// ---- Resumen ----
console.log("\nPor versión (final = (código + modelo) / 2):");
for (const v of VERSIONES) {
  const rs = resultados.filter((r) => r.version === v);
  const finales = rs.flatMap((r) => (r.final === null ? [] : [r.final]));
  const porRep = Array.from({ length: REPS }, (_, i) =>
    promedio(rs.filter((r) => r.rep === i + 1 && r.final !== null).map((r) => r.final as number)),
  );
  const rango = porRep.filter((x) => !Number.isNaN(x));
  if (!rango.length) rango.push(NaN);
  const noEnviables = rs.filter((r) => r.chequeos.some((c) => c.nombre === "enviable" && !c.ok)).length;
  console.log(
    `  ${v}: final ${f1(promedio(finales))} (reps ${f1(Math.min(...rango))}–${f1(Math.max(...rango))}) · ` +
      `código ${f1(promedio(rs.map((r) => r.codigo)))} · modelo ${f1(promedio(rs.flatMap((r) => (r.modelo === null ? [] : [r.modelo]))))} · ` +
      `no enviables ${noEnviables}/${rs.length} · errores ${rs.filter((r) => r.error).length} · sin juez ${rs.filter((r) => !r.error && r.modelo === null).length}`,
  );
}

console.log("\nPor caso (final promedio):");
console.log(`  ${"caso".padEnd(22)}${VERSIONES.map((v) => v.padStart(7)).join("")}   chequeos que fallaron`);
for (const c of casos) {
  const celdas = VERSIONES.map((v) =>
    f1(promedio(resultados.filter((r) => r.version === v && r.caso === c.id && r.final !== null).map((r) => r.final as number))).padStart(7),
  );
  const fallas = VERSIONES.map((v) => {
    const nombres = resultados
      .filter((r) => r.version === v && r.caso === c.id)
      .flatMap((r) => r.chequeos.filter((ch) => !ch.ok).map((ch) => ch.nombre));
    return nombres.length ? `${v}: ${[...new Set(nombres)].join(",")}` : "";
  }).filter(Boolean);
  console.log(`  ${c.id.padEnd(22)}${celdas.join("")}   ${fallas.join(" | ")}`);
}

const carpeta = new URL("./resultados/", import.meta.url);
mkdirSync(carpeta, { recursive: true });
const archivo = new URL(`${new Date().toISOString().replace(/[:.]/g, "-")}_${GEN.replace(/[^\w.-]/g, "_")}.json`, carpeta);
writeFileSync(archivo, JSON.stringify({ gen: GEN, juez: JUEZ, reps: REPS, temperatura: TEMPERATURA, resultados }, null, 2));
console.log(`\nDetalle completo: ${archivo.pathname}`);
