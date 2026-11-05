// Cómo anduvo la operación: lo arma el panel de agencia con los eventos de cada turno.
// summarizeOperations es puro: se prueba sin base ni red.

export interface TurnEvent {
  type: string;
  level: string;
  payload: Record<string, unknown> | null;
}

export interface OperationsSummary {
  turns: number;
  medianMs: number | null;
  p95Ms: number | null;
  unreviewed: number;
  forcedHandoffs: number;
  guardsActed: number;
  sendFailures: number;
  noReply: number;
  providerSwitches: number;
  knowledgeFailures: number;
  models: { model: string; turns: number }[];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summarizeOperations(events: TurnEvent[]): OperationsSummary {
  const turns = events.filter((e) => e.type === "turn_completed");
  const times = turns
    .map((e) => Number(e.payload?.total_ms))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const count = (type: string) => events.filter((e) => e.type === type).length;
  const models = new Map<string, number>();
  for (const t of turns) {
    const model = String(t.payload?.model ?? "desconocido");
    models.set(model, (models.get(model) ?? 0) + 1);
  }
  return {
    turns: turns.length,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    unreviewed: turns.filter((t) => ["review_failed", "rewrite_failed", "unresolved"].includes(String(t.payload?.review))).length,
    forcedHandoffs: turns.filter((t) => t.payload?.forced_handoff === true).length,
    guardsActed: turns.filter((t) => t.payload?.booking_offer_removed === true || Number(t.payload?.contact_data_saved) > 0).length,
    sendFailures: count("dispatch_failure"),
    noReply: count("batch_dead_letter") + count("turn_incomplete"),
    providerSwitches: count("llm_failover"),
    knowledgeFailures: count("kb_search_failed"),
    models: [...models].map(([model, n]) => ({ model, turns: n })).sort((a, b) => b.turns - a.turns),
  };
}

const TYPES = ["turn_completed", "dispatch_failure", "batch_dead_letter", "turn_incomplete", "llm_failover", "kb_search_failed"];

/** Últimas 24 horas de todos los clientes. Solo para el súper admin: usa la clave de servicio. */
export async function getOperationsSummary(): Promise<OperationsSummary> {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await db
    .from("events")
    .select("type, level, payload")
    .in("type", TYPES)
    .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
    .limit(5000);
  return summarizeOperations((data ?? []) as TurnEvent[]);
}
