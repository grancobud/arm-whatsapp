import { APICallError } from "ai";

// ──────────────────────────────────────────────────────────────────────────────
// Model fallback chain
//
// A reply must never die because ONE model is unavailable. Free OpenRouter
// models are rate-limited per shared upstream pool (HTTP 429 "temporarily
// rate-limited upstream"), some get gated (403), and paid ones fail with 402
// when the balance runs out. The chain tries the conversation's model first and
// then walks down this list, best to worst, with the SAME messages — so the
// thread of the conversation is preserved whatever model ends up answering.
//
// Measured on 2026-11-04 with a Spanish WhatsApp prompt (one run each, listed by
// OpenRouter as tool-calling capable; the tool call itself wasn't exercised):
//   dots-3-note        correct, says what it doesn't know, fastest to answer
//   nemotron-3-nano    correct, says what it doesn't know
//   nemotron-3.5-super correct, but about 500 tokens of reasoning first
//   north-mini-code    correct, skipped the question it had no data for
//   gemma-4-31b        good model, 429 in both tests (shared pool saturated)
//   openrouter/free    OpenRouter's own free router (picked nemotron-3-nano)
// Excluded: inkling and inkling-small (403, only for registered agentic apps),
// nemotron-3.5-lightning and xing4.0 (leak English reasoning into the reply),
// nemotron-3-ultra and flint (spend the budget reasoning), lfm-2.5 (made up a
// fact), stealth/* (logs prompts). No longer free: nemotron-3-super, nex-n2.5-pro,
// nex-n2.5-mini, qwen3.8-27b.
//
// NOTE: the 1,000 free requests/day are PER ACCOUNT across all ":free" models,
// not per model. The chain protects against saturated/failing models; once the
// daily free quota is spent, only the paid tail keeps the conversation going —
// and that needs OpenRouter credit.
//
// Override without a deploy of code: OPENROUTER_FALLBACK_MODELS (comma-separated).
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_FALLBACK_CHAIN: readonly string[] = [
  "dots-studio/dots-3-note-preview:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
  // Paid tail: only answers when there is OpenRouter credit.
  "openai/gpt-4o-mini",
];

/** The configured fallback list (env override wins over the default). */
export function fallbackChain(
  env: string | undefined = process.env.OPENROUTER_FALLBACK_MODELS,
): string[] {
  const fromEnv = (env ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_FALLBACK_CHAIN];
}

/** Primary model first, then the chain, without duplicates. */
export function buildModelChain(
  primary: string | undefined,
  chain: string[] = fallbackChain(),
): string[] {
  const out: string[] = [];
  for (const m of [primary, ...chain]) {
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Whether a failure with this model should move on to the next one.
 * Any API-level failure qualifies (429 saturated, 402 no credit, 403 gated,
 * 404 model gone / no endpoint with tools, 5xx, timeouts). A plain bug in our
 * own code (TypeError etc.) does not: switching models would not fix it.
 */
export function shouldFallBack(err: unknown): boolean {
  if (APICallError.isInstance(err)) return true;
  if (err instanceof Error) {
    const name = err.name ?? "";
    if (/AbortError|TimeoutError|APICallError|RetryError|NoContent/i.test(name)) return true;
    if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(err.message)) return true;
  }
  return false;
}

export class EmptyReplyError extends Error {
  constructor(model: string) {
    super(`Model ${model} returned an empty reply`);
    this.name = "NoContentError";
  }
}

/**
 * The model answered, but the text must not reach a customer: empty, cut by
 * the token limit, or its own reasoning leaked as the reply (see reply-guard).
 * Named like EmptyReplyError so shouldFallBack moves on to the next model.
 */
export class UnusableReplyError extends Error {
  constructor(model: string, reason?: string) {
    super(`Model ${model} returned an unusable reply (${reason ?? "unknown"})`);
    this.name = "NoContentError";
  }
}

export interface ChainAttempt {
  model: string;
  error: string;
}

/**
 * Runs `call` with each model of the chain until one succeeds.
 *
 * `hasSideEffects()` is checked after a failure: if the failed model already
 * executed a tool (e.g. booked a slot), we do NOT retry with another model —
 * that would repeat the action. The error is rethrown instead.
 */
export async function runWithModelChain<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  opts: {
    hasSideEffects?: () => boolean;
    onFallback?: (attempt: ChainAttempt, next: string) => void;
  } = {},
): Promise<{ result: T; model: string; attempts: ChainAttempt[] }> {
  const attempts: ChainAttempt[] = [];
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      try {
        return { result: await call(model), model, attempts };
      } catch (first) {
        // A router model ("auto") picks a different upstream each call, so an
        // unusable reply deserves one more try with the same id — unless a
        // tool already ran.
        if (!(first instanceof UnusableReplyError) || opts.hasSideEffects?.()) {
          throw first;
        }
        attempts.push({ model, error: first.message.slice(0, 200) });
        return { result: await call(model), model, attempts };
      }
    } catch (err) {
      lastErr = err;
      const attempt = { model, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
      attempts.push(attempt);
      if (opts.hasSideEffects?.()) throw err;
      if (!shouldFallBack(err) || i === models.length - 1) throw err;
      opts.onFallback?.(attempt, models[i + 1]);
    }
  }
  throw lastErr;
}
