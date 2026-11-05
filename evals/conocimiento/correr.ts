// Eval de la base de conocimiento: ¿la búsqueda trae el fragmento que tiene la respuesta?
// Compara:
// 1. Corte viejo (500 caracteres)
// 2. Corte por secciones (línea base Gastón: 15/17)
// 3. Corte con Recuperación Contextual (recuperación contextual)
// 4. Búsqueda semántica vs. Reranking Híbrido (BM25 + Dense RRF)
//
// Uso: npm run eval:conocimiento

import { readFileSync } from "node:fs";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { chunkDocument } from "../../src/features/inbox/services/kb-chunking.ts";
import { rerankHybrid } from "../../src/features/inbox/services/kb-rerank.ts";
import { exigirHuella } from "../exigir-huella.ts";

exigirHuella(import.meta.url);

const baseURL =
  process.env.EVAL_BASE_URL ||
  process.env.LLM_BASE_URL ||
  "http://localhost:31415/v1";
const apiKey =
  process.env.EVAL_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.FREELLMAPI_KEY;
const MODELO = process.env.KB_EMBEDDING_MODEL || "gemini-embedding-001";
const proveedor = createOpenAI({ baseURL, apiKey });
const modelo = proveedor.embedding(MODELO);

const documento = readFileSync(
  new URL("./documento.md", import.meta.url),
  "utf8",
);
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
  let p = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return p / Math.sqrt(na * nb);
};

async function evaluar(
  nombre: string,
  fragmentos: string[],
  vectoresPreguntas: number[][],
) {
  const { embeddings } = await embedMany({
    model: modelo,
    values: fragmentos,
    providerOptions: { openai: { dimensions: 1536 } },
  });
  let aciertosSem = 0,
    aciertosRerank = 0,
    total = 0;
  const filas: string[] = [];

  for (const [i, p] of preguntas.entries()) {
    // 1. Similitud semántica pura
    const sem = fragmentos
      .map((f, j) => ({
        chunk: f,
        similarity: coseno(vectoresPreguntas[i], embeddings[j]),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    // 2. Reranking híbrido sobre top 10 candidatos (BM25 + Dense RRF)
    const top10 = sem.slice(0, 10);
    const reranked = rerankHybrid(p.q, top10, 3);
    const top3Sem = sem.slice(0, 3).map((x) => x.chunk);
    const top3Rerank = reranked.slice(0, 3).map((x) => x.chunk);

    if (p.evidencia === null) {
      filas.push(
        `  ${p.q.padEnd(48)} (sin respuesta)  similitud máx ${sem[0].similarity.toFixed(3)}`,
      );
      continue;
    }
    total++;
    const okSem = top3Sem.some((f) => f.includes(p.evidencia!));
    const okRerank = top3Rerank.some((f) => f.includes(p.evidencia!));
    const pos = sem.findIndex((x) => x.chunk.includes(p.evidencia!));
    aciertosSem += +okSem;
    aciertosRerank += +okRerank;
    filas.push(
      `  ${p.q.padEnd(48)} semántica ${okSem ? "✅" : "❌"} (pos ${pos + 1 || "—"}, sim ${sem[0].similarity.toFixed(3)})  rerank ${okRerank ? "✅" : "❌"}`,
    );
  }
  console.log(
    `\n${nombre}: ${fragmentos.length} fragmentos · semántica ${aciertosSem}/${total} · rerank ${aciertosRerank}/${total}`,
  );
  console.log(filas.join("\n"));
}

const { embeddings: vq } = await embedMany({
  model: modelo,
  values: preguntas.map((p) => p.q),
  providerOptions: { openai: { dimensions: 1536 } },
});

console.log(
  `Eval base de conocimiento · embeddings ${MODELO} · ${preguntas.length} preguntas (top 3)`,
);
await evaluar("1. Corte viejo (500 caracteres)", corteViejo(documento), vq);
await evaluar(
  "2. Corte por secciones (línea base Gastón)",
  chunkDocument(documento),
  vq,
);
await evaluar(
  "3. Corte con Recuperación Contextual (Tomas)",
  chunkDocument(documento, { contextualPrefix: true }),
  vq,
);
