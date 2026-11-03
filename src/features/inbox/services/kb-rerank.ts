/**
 * kb-rerank.ts — Reranking service for Knowledge Base retrieval.
 *
 * Implements:
 * Hybrid BM25 + dense fusion using Reciprocal Rank Fusion (RRF), in memory:
 * no model call, so no extra tokens and no customer text leaves the server.
 * Falls back to the original vector ranking when no query term matches.
 */


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
