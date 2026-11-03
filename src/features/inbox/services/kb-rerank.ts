/**
 * kb-rerank.ts — Reranking service for Knowledge Base retrieval.
 *
 * Implements:
 * 1. Hybrid BM25 + Dense fusion using Reciprocal Rank Fusion (RRF)
 *    (Claude Academy Lessons 37 & 38).
 * 2. LLM-based relevance reranking (Model-based rescoring).
 * 3. Graceful fallback to original vector similarity ranking on error.
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export interface CandidateChunk {
  chunk: string;
  document_title?: string;
  document_id?: string;
  similarity?: number;
}

export interface RerankResult<T extends CandidateChunk = CandidateChunk> {
  item: T;
  score: number;
  originalRank: number;
  rerankedRank: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lexical / BM25 Tokenizer & Scorer
// ──────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  "el la los las un una unos unas de del en y o u a al con sin por para que qué de me mi se si no es son lo como cuanto cuándo donde cuál".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []
  ).filter((token) => !STOPWORDS.has(token) && token.length > 1);
}

/**
 * BM25 Scoring over an in-memory collection of candidates.
 * Standard parameters: k1 = 1.2, b = 0.75.
 */
export function scoreBM25(
  queryTokens: string[],
  docTokens: string[],
  docCount: number,
  avgDocLength: number,
  docFrequency: Map<string, number>,
  k1 = 1.2,
  b = 0.75,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docLength = docTokens.length;
  const termFrequency = new Map<string, number>();
  for (const t of docTokens) {
    termFrequency.set(t, (termFrequency.get(t) ?? 0) + 1);
  }

  let totalScore = 0;
  for (const t of queryTokens) {
    const f = termFrequency.get(t) ?? 0;
    if (f === 0) continue;

    const n = docFrequency.get(t) ?? 1;
    // Standard Robertson-Spärck Jones IDF
    const idf = Math.log(1 + (docCount - n + 0.5) / (n + 0.5));
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * (docLength / (avgDocLength || 1)));
    totalScore += idf * (numerator / denominator);
  }

  return totalScore;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reciprocal Rank Fusion (RRF)
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RRF_K = 60;

/**
 * Combines multiple ranked lists into a single ranked list using Reciprocal Rank Fusion.
 * Formula: score(item) = Σ [ 1 / (k + rank_i + 1) ]
 */
export function reciprocalRankFusion<T>(
  rankings: T[][],
  keyFn: (item: T) => string,
  k = DEFAULT_RRF_K,
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of rankings) {
    list.forEach((item, rank) => {
      const key = keyFn(item);
      const existing = scores.get(key);
      const addition = 1 / (k + rank + 1);
      if (existing) {
        existing.score += addition;
      } else {
        scores.set(key, { item, score: addition });
      }
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/**
 * Hybrid reranking using BM25 lexical ranking merged with original dense vector ranking.
 */
export function rerankHybrid<T extends CandidateChunk>(
  query: string,
  candidates: T[],
  topK = 3,
  k = DEFAULT_RRF_K,
): T[] {
  if (candidates.length <= 1) return candidates.slice(0, topK);

  const queryTokens = tokenize(query);
  const docTokensList = candidates.map((c) => tokenize(c.chunk));
  const docCount = candidates.length;
  const avgDocLength =
    docTokensList.reduce((acc, t) => acc + t.length, 0) / (docCount || 1);

  // Document frequency: how many documents contain token t
  const docFrequency = new Map<string, number>();
  for (const tokens of docTokensList) {
    const unique = new Set(tokens);
    for (const u of unique) {
      docFrequency.set(u, (docFrequency.get(u) ?? 0) + 1);
    }
  }

  // 1. Lexical ranking (BM25)
  const lexicalRanked = candidates
    .map((item, idx) => ({
      item,
      bm25: scoreBM25(
        queryTokens,
        docTokensList[idx],
        docCount,
        avgDocLength,
        docFrequency,
      ),
    }))
    .filter((x) => x.bm25 > 0)
    .sort((a, b) => b.bm25 - a.bm25)
    .map((x) => x.item);

  // 2. Dense semantic ranking (original similarity order)
  const denseRanked = [...candidates].sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0),
  );

  // If lexical found no overlapping terms, preserve dense ranking
  if (lexicalRanked.length === 0) {
    return denseRanked.slice(0, topK);
  }

  // Merge using RRF
  const fused = reciprocalRankFusion(
    [denseRanked, lexicalRanked],
    (item) => item.chunk,
    k,
  );

  return fused.slice(0, topK).map((f) => f.item);
}

// ──────────────────────────────────────────────────────────────────────────────
// Model-based Reranking (LLM cross-scoring)
// ──────────────────────────────────────────────────────────────────────────────

export interface ModelRerankOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Re-scores candidate chunks against the user query using an LLM prompt.
 * Falls back to dense ranking on timeout, error, or missing credentials.
 */
export async function rerankWithModel<T extends CandidateChunk>(
  query: string,
  candidates: T[],
  topK = 3,
  options?: ModelRerankOptions,
): Promise<T[]> {
  if (candidates.length <= topK) return candidates.slice(0, topK);

  const baseURL =
    options?.baseURL ||
    process.env.LLM_BASE_URL ||
    process.env.EVAL_BASE_URL ||
    "http://localhost:31415/v1";
  const apiKey =
    options?.apiKey ||
    process.env.LLM_API_KEY ||
    process.env.EVAL_API_KEY ||
    process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey === "placeholder") {
    return rerankHybrid(query, candidates, topK);
  }

  try {
    const provider = createOpenAI({ baseURL, apiKey });
    const model = provider(options?.model || "auto:fast");

    const candidatePrompt = candidates
      .map(
        (c, idx) =>
          `[ID: ${idx + 1}]\n${c.chunk.slice(0, 350).trim()}`,
      )
      .join("\n\n");

    const prompt = [
      "Eres un reranker de información para un sistema RAG de atención a clientes.",
      "Tu tarea es ordenar los fragmentos por relevancia DIRECTA para responder la consulta.",
      "",
      `<consulta>${query}</consulta>`,
      "",
      "<fragmentos>",
      candidatePrompt,
      "</fragmentos>",
      "",
      `Devuelve ÚNICAMENTE los números de ID de los ${topK} fragmentos más relevantes, en orden de mayor a menor relevancia, separados por comas (por ejemplo: 3, 1, 5). No agregues explicaciones.`,
    ].join("\n");

    const result = await generateText({
      model,
      prompt,
      temperature: 0,
    });

    const parsedIds = (result.text.match(/\d+/g) ?? [])
      .map((n) => parseInt(n, 10) - 1)
      .filter((idx) => idx >= 0 && idx < candidates.length);

    if (parsedIds.length === 0) {
      return rerankHybrid(query, candidates, topK);
    }

    const seen = new Set<number>();
    const reordered: T[] = [];
    for (const idx of parsedIds) {
      if (!seen.has(idx)) {
        seen.add(idx);
        reordered.push(candidates[idx]);
        if (reordered.length >= topK) break;
      }
    }

    // Fill remaining spots if model returned fewer than topK
    for (const c of candidates) {
      if (reordered.length >= topK) break;
      if (!reordered.includes(c)) {
        reordered.push(c);
      }
    }

    return reordered;
  } catch (err) {
    console.warn("[kb-rerank] model reranking fallback to hybrid:", err);
    return rerankHybrid(query, candidates, topK);
  }
}
