// Fusión para búsqueda híbrida (experimento del eval, no se usa en producción:
// con gemini-embedding-001 la semántica sola ya acierta, ver correr.ts).
//
// Semantic search misses exact terms (codes like "PROMO-NOV-24", product names);
// lexical search misses paraphrases. Each returns its own ranking and the two
// are fused with Reciprocal Rank Fusion: only the ORDER counts, so a cosine
// similarity and a text-search rank never get compared as raw numbers.
// A list that found nothing simply does not vote.

export const RRF_K = 60;

export function reciprocalRankFusion<T>(
  rankings: T[][],
  key: (item: T) => string,
  k = RRF_K,
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((item, i) => {
      const id = key(item);
      const prev = scores.get(id);
      const add = 1 / (k + i + 1);
      if (prev) prev.score += add;
      else scores.set(id, { item, score: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
