import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { evaluateHealth, OVERDUE_MINUTES, STUCK_MINUTES } from "@/features/alerts/health";
import { safeError } from "@/lib/safe-error";

// Pública a propósito: la consulta un vigilante externo. Solo devuelve cantidades,
// nunca clientes ni contenido. No llama a ningún modelo, para no gastar cupo.
export const dynamic = "force-dynamic";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export async function GET(): Promise<NextResponse> {
  let input = { databaseOk: false, overdueBatches: 0, stuckBatches: 0, overdueFollowUps: 0 };
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const count = { count: "exact", head: true } as const;
    const [overdue, stuck, followUps] = await Promise.all([
      db.from("message_batches").select("id", count).eq("status", "buffering").lt("flush_at", minutesAgo(OVERDUE_MINUTES)),
      db.from("message_batches").select("id", count).eq("status", "processing").lt("updated_at", minutesAgo(STUCK_MINUTES)),
      db.from("follow_ups").select("id", count).eq("status", "pending").lt("due_at", minutesAgo(STUCK_MINUTES)),
    ]);
    const error = overdue.error ?? stuck.error ?? followUps.error;
    if (error) throw error;
    input = {
      databaseOk: true,
      overdueBatches: overdue.count ?? 0,
      stuckBatches: stuck.count ?? 0,
      overdueFollowUps: followUps.count ?? 0,
    };
  } catch (err) {
    console.error("[health]", safeError(err));
  }
  const { ok, problems } = evaluateHealth(input);
  return NextResponse.json({ ok, problems }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
