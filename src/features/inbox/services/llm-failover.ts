// Backup for the AI endpoint. Replies come from LLM_BASE_URL (FreeLLMAPI on
// Gastón's PC, reached through a Cloudflare tunnel). If that PC is off or the
// tunnel drops, every customer would stop getting answers. So when the
// primary endpoint fails, the same request goes to OpenRouter with a backup
// model, and the primary is skipped for a minute (no waiting on a dead host
// for every message). The owner gets an alert email (event llm_failover).
//
// Works at the fetch level, so every caller (replies, tool calls, summaries)
// gets it without changes. The pure parts are tested in evals/respaldo.

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** After a failure, go straight to the backup for this long. */
export const PRIMARY_COOLDOWN_MS = 60_000;
/** A reply that takes longer than this counts as the primary being down. */
export const PRIMARY_TIMEOUT_MS = 45_000;
/**
 * Backup models, tried in order. Free models come and go on OpenRouter (the
 * old default stopped being free), so there are two, and the last one is
 * OpenRouter's own router over whatever free models exist. LLM_BACKUP_MODELS
 * (comma-separated) overrides them.
 */
export const DEFAULT_BACKUP_MODELS = ["google/gemma-4-31b-it:free", "openrouter/free"];

export function backupModelsFromEnv(value: string | undefined): string[] {
  const list = (value ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_BACKUP_MODELS;
}

/**
 * Pure: does this answer from the primary mean "it's down, use the backup"?
 * 5xx and Cloudflare's tunnel errors (52x/530) yes; 429 too (FreeLLMAPI runs
 * out of free quota). A 4xx is our request being wrong: the backup would
 * fail the same way, so no.
 */
export function shouldFailover(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Pure: the request to send to OpenRouter instead. */
export function rewriteForBackup(
  url: string,
  init: { body?: unknown; headers?: HeadersInit },
  primaryBase: string,
  backupKey: string,
  backupModel: string,
): { url: string; init: RequestInit } {
  const base = primaryBase.replace(/\/+$/, "");
  const path = url.startsWith(base) ? url.slice(base.length) : new URL(url).pathname.replace(/^\/v1/, "");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${backupKey}`);
  let body = init.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      parsed.model = backupModel;
      body = JSON.stringify(parsed);
    } catch {
      // Not JSON: send as is.
    }
  }
  return { url: `${OPENROUTER_BASE_URL}${path}`, init: { ...init, headers, body: body as BodyInit } };
}

let primaryDownUntil = 0;

export function primaryLooksDown(now = Date.now()): boolean {
  return now < primaryDownUntil;
}

export function markPrimaryDown(now = Date.now()): void {
  primaryDownUntil = now + PRIMARY_COOLDOWN_MS;
}

/** Test hook. */
export function resetPrimaryState(): void {
  primaryDownUntil = 0;
}

export interface FailoverOptions {
  primaryBase: string;
  backupKey: string;
  backupModels: string[];
  /** Called once per switch to the backup (alert, log). Must not throw. */
  onFailover?: (reason: string) => void;
  fetchImpl?: typeof fetch;
}

/**
 * fetch that tries the primary endpoint and, if it's down, the backup.
 * Without a backup key it behaves exactly like fetch.
 */
export function createFailoverFetch(opts: FailoverOptions): typeof fetch {
  const doFetch = opts.fetchImpl ?? fetch;
  // Next backup model when one is gone (404), out of quota (429) or down.
  const backup = async (url: string, init: RequestInit | undefined) => {
    let res: Response | undefined;
    for (const model of opts.backupModels) {
      const b = rewriteForBackup(url, init ?? {}, opts.primaryBase, opts.backupKey, model);
      res = await doFetch(b.url, b.init);
      if (!shouldFailover(res.status) && res.status !== 404) return res;
    }
    return res!;
  };

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!opts.backupKey) return doFetch(input, init);
    if (primaryLooksDown()) return backup(url, init);

    const timeout = AbortSignal.timeout(PRIMARY_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let reason: string;
    try {
      const res = await doFetch(input, { ...init, signal });
      if (!shouldFailover(res.status)) return res;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      // The caller cancelled: don't retry somewhere else.
      if (init?.signal?.aborted) throw err;
      reason = timeout.aborted ? "sin respuesta a tiempo" : err instanceof Error ? err.message : String(err);
    }
    markPrimaryDown();
    try {
      opts.onFailover?.(reason);
    } catch {
      // never block the reply on the alert
    }
    return backup(url, init);
  };
}
