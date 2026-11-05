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
//   --juez-fijo   usa solo el primer juez: si falla, el caso queda "sin juez" (nunca otro modelo).
// Huella del evaluador (ver evals/huella.ts): si cambió el examen, la eval no corre hasta re-aprobarla:
//   npm run eval:agente -- --aprobar-huella="motivo" --aprobada-por="nombre"
// Variables: EVAL_BASE_URL (o LLM_BASE_URL), EVAL_API_KEY (o LLM_API_KEY / FREELLMAPI_KEY).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext } from "../../src/features/inbox/services/business-info.ts";
import { formatClaimsContext } from "../../src/features/arm/services/claims.ts";
import { formatKbContext } from "../../src/features/inbox/services/kb-service.ts";
import { splitCitations } from "../../src/features/inbox/services/kb-citations.ts";
import type { ClaimRow } from "../../src/features/arm/types/index.ts";
import { calificarPorCodigo, montosEn, type Caso, type Chequeo } from "./calificadores.ts";
import { AHORA_FIJO, NEGOCIO, PRECIOS_PERMITIDOS } from "./negocio.ts";
import { PROMPTS } from "./prompts.ts";
import {
  aprobarHuella, calcularHuella, cierreDeImports, explicarRechazo, hashTexto, normalizarModelo, resumenHuella,
  revisarHuella,
} from "../huella.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const GEN = args.gen || "mistral-medium-3.5";
// Varios jueces: si el primero está saturado se pasa al siguiente (nunca el mismo que responde).
const JUEZ_FIJO = "juez-fijo" in args;
const CADENA = (args.juez || "qwen3.8-max,minimax-m3,qwen3.7-plus,gemma-4-31b-it").split(",");
const JUECES = JUEZ_FIJO ? CADENA.slice(0, 1) : CADENA;
const JUEZ = JUECES.join(" → ");
const REPS = Number(args.reps || 3);
const PARALELO = Number(args.paralelo || 4);
const VERSIONES = (args.versiones || "v1,v2").split(",");
const TEMPERATURA = 0.3; // la de producción (DEFAULT_TEMPERATURE)
const MAX_TOKENS_RESPUESTA = 700;
const MAX_TOKENS_JUEZ = 1000;

// ---- Huella del examen: todo lo que define la nota, menos los prompts que se comparan ----
const CONFIG_EXAMEN = {
  gen: GEN, jueces: JUECES, juezFijo: JUEZ_FIJO, temperatura: TEMPERATURA,
  maxTokensRespuesta: MAX_TOKENS_RESPUESTA, maxTokensJuez: MAX_TOKENS_JUEZ,
};
// El runner (incluye el prompt del juez), los casos y todo el código que importan,
// menos los prompts que se comparan.
const ARCHIVOS_EXAMEN = cierreDeImports(
  ["evals/agente/correr.ts", "evals/agente/casos.json"],
  undefined,
  ["evals/agente/prompts.ts"],
);
const APROBACION = fileURLToPath(new URL("./huella-aprobada.json", import.meta.url));
const huella = calcularHuella(ARCHIVOS_EXAMEN, CONFIG_EXAMEN);
if ("aprobar-huella" in args) {
  aprobarHuella(huella, CONFIG_EXAMEN, APROBACION, args["aprobada-por"] || userInfo().username, args["aprobar-huella"]);
  console.log(`Huella ${resumenHuella(huella)} aprobada: ${args["aprobar-huella"]}`);
}
const revision = revisarHuella(huella, APROBACION);
if (revision.estado !== "aprobada") {
  console.error(explicarRechazo(revision, "npm run eval:agente"));
  process.exit(1);
}

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
    kbContext: formatKbContext(
      (caso.conocimiento ?? []).map((k) => ({ chunk: k.texto, document_title: k.titulo, document_id: "", similarity: 1 })),
    ),
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
  const conocimiento = (caso.conocimiento ?? []).map((k) => k.texto).join("\n") || "(ninguno)";
  const prompt = `Sos un evaluador experto en atención al cliente por WhatsApp. Evaluá la ÚLTIMA respuesta del agente de una barbería.

<negocio>
${buildBusinessInfoContext(NEGOCIO)}
</negocio>

<memoria_del_cliente_que_vio_el_agente>
${memoria}
</memoria_del_cliente_que_vio_el_agente>

<base_de_conocimiento_que_vio_el_agente>
${conocimiento}
</base_de_conocimiento_que_vio_el_agente>

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
    maxOutputTokens: MAX_TOKENS_JUEZ,
  });
  const llamada = r.toolCalls[0];
  if (!llamada) throw new Error(`El juez no llamó a la herramienta: ${r.text.slice(0, 120)}`);
  // Con --juez-fijo el proxy no puede cambiar de modelo a escondidas: si respondió otro, no cuenta.
  if (JUEZ_FIJO && normalizarModelo(r.response.modelId) !== normalizarModelo(juez)) {
    throw new Error(`Se pidió el juez ${juez} y respondió ${r.response.modelId}`);
  }
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
        maxOutputTokens: MAX_TOKENS_RESPUESTA,
      }),
    );
    // Como en producción: la línea "FUENTES: F1" se saca antes de que la vea el cliente.
    const citas = splitCitations(r.text);
    // Los montos de la base de conocimiento que vio el agente también son reales.
    const permitidos = new Set([...PRECIOS_PERMITIDOS, ...(caso.conocimiento ?? []).flatMap((k) => montosEn(k.texto))]);
    const calif = calificarPorCodigo(caso, citas.text, r.finishReason, permitidos);
    if (caso.cita_esperada) {
      const ok = [...citas.ids].sort().join(",") === [...caso.cita_esperada].sort().join(",");
      calif.chequeos.push({ nombre: "cita_correcta", ok, detalle: `citó [${citas.ids.join(",")}]` });
      calif.puntaje = (10 * calif.chequeos.filter((c) => c.ok).length) / calif.chequeos.length;
    }
    const { puntaje: codigo, chequeos } = calif;
    let modelo: number | null = null;
    let juez: Resultado["juez"];
    try {
      const j = await calificarPorModelo(caso, citas.text);
      modelo = j.score;
      juez = { strengths: j.strengths, weaknesses: j.weaknesses, reasoning: j.reasoning, modelo: j.modelo };
    } catch (err) {
      juez = undefined;
      console.error(`  [juez falló] ${version}/${caso.id}#${rep}: ${String(err).slice(0, 120)}`);
    }
    return {
      version, caso: caso.id, rep, respuesta: citas.text, finishReason: r.finishReason,
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
console.log(
  `Huella del examen ${resumenHuella(huella)} (aprobada ${revision.aprobacion.fecha.slice(0, 10)} por ${revision.aprobacion.aprobadaPor})` +
    (args.casos ? " · subconjunto de casos: no comparable con la línea base" : ""),
);
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

// Si el juez fue rotando, la diferencia entre versiones puede venir del juez y no del prompt:
// se muestra la nota del juez por versión, separada por qué modelo calificó.
console.log("\nNota del juez por versión, separada por juez (n = respuestas calificadas):");
const jueces = [...new Set(resultados.flatMap((r) => (r.juez ? [normalizarModelo(r.juez.modelo)] : [])))].sort();
for (const j of jueces) {
  const celdas = VERSIONES.map((v) => {
    const notas = resultados.filter((r) => r.version === v && r.juez && normalizarModelo(r.juez.modelo) === j).map((r) => r.modelo as number);
    return `${v} ${f1(promedio(notas))} (n=${notas.length})`;
  });
  console.log(`  ${j.padEnd(22)}${celdas.join(" · ")}`);
}
if (jueces.length > 1) console.log("  Ojo: calificaron varios jueces. Para comparar versiones con un solo juez, usá --juez-fijo.");

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
const promptsEvaluados = Object.fromEntries(VERSIONES.map((v) => [v, hashTexto(PROMPTS[v] ?? "").slice(0, 12)]));
writeFileSync(
  archivo,
  JSON.stringify(
    {
      gen: GEN, juez: JUEZ, juezFijo: JUEZ_FIJO, reps: REPS, temperatura: TEMPERATURA,
      huella: { total: huella.total, aprobadaEl: revision.aprobacion.fecha, aprobadaPor: revision.aprobacion.aprobadaPor },
      casosUsados: args.casos ? casos.map((c) => c.id) : "todos",
      promptsEvaluados,
      resultados,
    },
    null,
    2,
  ),
);
console.log(`\nDetalle completo: ${archivo.pathname}`);
