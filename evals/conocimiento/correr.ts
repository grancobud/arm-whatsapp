// Eval de la base de conocimiento: ¿la búsqueda trae el fragmento que tiene la respuesta?
// Compara el corte viejo (500 caracteres) con el nuevo (por secciones) y la búsqueda
// solo semántica con la híbrida (semántica + palabras, fusionadas con RRF).
// Embeddings reales por FreeLLMAPI; el coseno se calcula acá igual que pgvector.
// La parte léxica imita la búsqueda de texto de Postgres (términos sin tildes, en minúscula).
//
// Uso: npm run eval:conocimiento

import { readFileSync } from "node:fs";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { chunkDocument } from "../../src/features/inbox/services/kb-chunking.ts";
import { reciprocalRankFusion } from "./fusion.ts";

const baseURL = process.env.EVAL_BASE_URL || process.env.LLM_BASE_URL || "http://localhost:31415/v1";
const apiKey = process.env.EVAL_API_KEY || process.env.LLM_API_KEY || process.env.FREELLMAPI_KEY;
const MODELO = process.env.KB_EMBEDDING_MODEL || "gemini-embedding-001";
const proveedor = createOpenAI({ baseURL, apiKey });
const modelo = proveedor.embedding(MODELO);

const documento = readFileSync(new URL("./documento.md", import.meta.url), "utf8");
const preguntas: { q: string; evidencia: string | null }[] = JSON.parse(
  readFileSync(new URL("./preguntas.json", import.meta.url), "utf8"),
);

function corteViejo(text: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length; start += 450) {
    out.push(text.slice(start, start + 500));
    if (start + 500 >= text.length) break;
  }
  return out;
}

const coseno = (a: number[], b: number[]) => {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return p / Math.sqrt(na * nb);
};
const terminos = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
const VACIAS = new Set("el la los las un una de del en y o a que qué para por con me mi se si sin es son lo al cuanto cuando como".split(" "));

async function evaluar(nombre: string, fragmentos: string[], vectoresPreguntas: number[][]) {
  const { embeddings } = await embedMany({ model: modelo, values: fragmentos, providerOptions: { openai: { dimensions: 1536 } } });
  let aciertosSem = 0, aciertosHib = 0, total = 0;
  const filas: string[] = [];
  for (const [i, p] of preguntas.entries()) {
    const sem = fragmentos
      .map((f, j) => ({ f, sim: coseno(vectoresPreguntas[i], embeddings[j]) }))
      .sort((a, b) => b.sim - a.sim);
    const qt = terminos(p.q).filter((t) => !VACIAS.has(t));
    const lex = fragmentos
      .map((f) => ({ f, n: terminos(f).filter((t) => qt.includes(t)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const hib = reciprocalRankFusion([sem.slice(0, 20), lex.slice(0, 20)], (x: { f: string }) => x.f).map((x) => x.item.f);
    const top3Sem = sem.slice(0, 3).map((x) => x.f);
    if (p.evidencia === null) {
      filas.push(`  ${p.q.padEnd(48)} (sin respuesta)  similitud máx ${sem[0].sim.toFixed(3)}`);
      continue;
    }
    total++;
    const okSem = top3Sem.some((f) => f.includes(p.evidencia!));
    const okHib = hib.slice(0, 3).some((f) => f.includes(p.evidencia!));
    const pos = sem.findIndex((x) => x.f.includes(p.evidencia!));
    aciertosSem += +okSem; aciertosHib += +okHib;
    filas.push(`  ${p.q.padEnd(48)} semántica ${okSem ? "✅" : "❌"} (pos ${pos + 1 || "—"}, sim ${sem[0].sim.toFixed(3)})  híbrida ${okHib ? "✅" : "❌"}`);
  }
  console.log(`\n${nombre}: ${fragmentos.length} fragmentos · semántica ${aciertosSem}/${total} · híbrida ${aciertosHib}/${total}`);
  console.log(filas.join("\n"));
}

const { embeddings: vq } = await embedMany({ model: modelo, values: preguntas.map((p) => p.q), providerOptions: { openai: { dimensions: 1536 } } });
console.log(`Eval base de conocimiento · embeddings ${MODELO} · ${preguntas.length} preguntas (top 3)`);
await evaluar("Corte viejo (500 caracteres)", corteViejo(documento), vq);
await evaluar("Corte nuevo (por secciones)", chunkDocument(documento), vq);
