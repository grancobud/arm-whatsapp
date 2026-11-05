import { createServiceClient as svc } from "@/lib/supabase/service";
// F8-D2: Observability service — query events per conversation, compute cost/token metrics.
// SEC-09: All payloads are redacted before leaving this module.



export interface ConversationMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLlmCalls: number;
  /** Rough estimate: (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000 */
  estimatedCostUsd: number;
  toolCallCount: number;
  stateChanges: number;
  lastActivity: string | null;
}

export interface EventLogEntry {
  id: string;
  type: string;
  level: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// SEC-09: Keys whose values must never be surfaced to the client.
const SENSITIVE_KEY_PATTERN =
  /credentials|oauth_tokens|api_key|authorization|token|secret|password/i;

/**
 * Recursively walk a plain object and replace values of sensitive keys
 * with '[REDACTED]'. Non-object values are returned as-is.
 */
export function redactSensitivePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = redactSensitivePayload(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? redactSensitivePayload(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Aggregate metrics for a conversation from the events table.
 * Sums prompt/completion tokens from llm_usage events, counts tool_call and state_change events.
 */
export async function getConversationMetrics(
  conversationId: string,
): Promise<ConversationMetrics> {
  const supabase = svc();

  const { data: events, error } = await supabase
    .from("events")
    .select("type, payload, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "[observability] getConversationMetrics error:",
      error.message,
    );
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalLlmCalls: 0,
      estimatedCostUsd: 0,
      toolCallCount: 0,
      stateChanges: 0,
      lastActivity: null,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLlmCalls = 0;
  let toolCallCount = 0;
  let stateChanges = 0;
  const lastActivity =
    events.length > 0 ? (events[0].created_at as string) : null;

  for (const event of events ?? []) {
    const type = event.type as string;
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    if (type === "llm_usage") {
      totalLlmCalls++;
      const promptTokens =
        typeof payload.prompt_tokens === "number" ? payload.prompt_tokens : 0;
      const completionTokens =
        typeof payload.completion_tokens === "number"
          ? payload.completion_tokens
          : 0;
      totalInputTokens += promptTokens;
      totalOutputTokens += completionTokens;
    } else if (type === "tool_call") {
      toolCallCount++;
    } else if (type === "state_change") {
      stateChanges++;
    }
  }

  // Rough cost estimate using mid-tier pricing
  const estimatedCostUsd =
    (totalInputTokens * 0.15 + totalOutputTokens * 0.6) / 1_000_000;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalLlmCalls,
    estimatedCostUsd,
    toolCallCount,
    stateChanges,
    lastActivity,
  };
}

/**
 * Return the last N events for a conversation.
 * SEC-09: Sensitive keys are redacted from all payloads before returning.
 */
export async function getConversationEvents(
  conversationId: string,
  limit = 20,
): Promise<EventLogEntry[]> {
  const supabase = svc();

  const { data: rows, error } = await supabase
    .from("events")
    .select("id, type, level, payload, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[observability] getConversationEvents error:",
      error.message,
    );
    return [];
  }

  return (rows ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as string,
    level: (row.level as string) ?? "info",
    payload: redactSensitivePayload(
      (row.payload ?? {}) as Record<string, unknown>,
    ),
    created_at: row.created_at as string,
  }));
}
