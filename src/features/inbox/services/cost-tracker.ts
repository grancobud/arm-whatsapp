import { createServiceClient as svc } from "@/lib/supabase/service";
import { performance } from "node:perf_hooks";

const LLM_TURNS_PER_CONTACT_PER_HOUR = 20;
const LLM_DAILY_BUDGET_TOKENS = 1_000_000;


interface RecordLlmUsageOpts {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Inserts an llm_usage event into the events table for observability and
 * rate-limit accounting.
 */
export async function recordLlmUsage(opts: RecordLlmUsageOpts): Promise<void> {
  const supabase = svc();

  const {
    workspaceId,
    conversationId,
    contactId,
    model,
    promptTokens,
    completionTokens,
  } = opts;

  const totalTokens = promptTokens + completionTokens;

  await supabase.from("events").insert({
    type: "llm_usage",
    level: "info",
    workspace_id: workspaceId,
    conversation_id: conversationId,
    payload: {
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      contact_id: contactId,
    },
  });
}

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks per-contact hourly turn limit and workspace daily token budget.
 *
 * Returns { allowed: false, reason } when either ceiling is breached,
 * { allowed: true } otherwise.
 */
export async function checkRateLimits(
  workspaceId: string,
  contactId: string,
): Promise<RateLimitResult> {
  const supabase = svc();

  const nowMs = performance.timeOrigin + performance.now();

  // ── 1. Per-contact hourly turn limit ──────────────────────────────────────
  const hourAgo = new Date(nowMs - 3_600_000).toISOString();

  const { data: hourlyEvents, error: hourlyError } = await supabase
    .from("events")
    .select("id")
    .eq("type", "llm_usage")
    .eq("workspace_id", workspaceId)
    .filter("payload->>contact_id", "eq", contactId)
    .gte("created_at", hourAgo);

  if (hourlyError) {
    console.error("[cost-tracker] hourly check error:", hourlyError);
    // Fail open — don't block on DB errors
    return { allowed: true };
  }

  if ((hourlyEvents?.length ?? 0) >= LLM_TURNS_PER_CONTACT_PER_HOUR) {
    return { allowed: false, reason: "rate_limit_contact_hour" };
  }

  // ── 2. Workspace daily token budget ───────────────────────────────────────
  const dayStart = new Date(nowMs);
  dayStart.setUTCHours(0, 0, 0, 0);

  const { data: dailyEvents, error: dailyError } = await supabase
    .from("events")
    .select("payload")
    .eq("type", "llm_usage")
    .eq("workspace_id", workspaceId)
    .gte("created_at", dayStart.toISOString());

  if (dailyError) {
    console.error("[cost-tracker] daily check error:", dailyError);
    return { allowed: true };
  }

  const totalTokensToday = (dailyEvents ?? []).reduce((sum, row) => {
    const payload = row.payload as Record<string, unknown> | null;
    const t = payload?.total_tokens;
    return sum + (typeof t === "number" ? t : 0);
  }, 0);

  if (totalTokensToday >= LLM_DAILY_BUDGET_TOKENS) {
    return { allowed: false, reason: "daily_token_budget_exceeded" };
  }

  return { allowed: true };
}
