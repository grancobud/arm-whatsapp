import { safeError } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron-auth";
import { processNextBatch } from "@/features/inbox/services/buffer";
import { drainCampaignQueue } from "@/features/arm/services/campaigns";
import { checkAlerts } from "@/features/alerts/alerts";
import { runAutomations } from "@/features/automations/engine";
import { failStaleProposals, runFollowUps } from "@/features/arm/services/follow-ups";

// ──────────────────────────────────────────────────────────────────────────────
// Vercel Cron: process buffer batches every minute
//
// For production at scale, consider:
//   - pg_cron every 5s for lower latency
//   - pgmq (message queue) for fan-out across multiple workers
//
// Vercel sets Authorization: Bearer {CRON_SECRET} automatically when the
// cron job is configured in vercel.json.
// ──────────────────────────────────────────────────────────────────────────────

export const schedule = "* * * * *";

// Max batches to drain per cron tick — protects against burst accumulation
const MAX_BATCHES_PER_RUN = 10;
// Una charla ocupada o un lote que falla no cuentan como atendidos, pero tampoco pueden
// frenar la cola: cada uno vuelve a esperar y el siguiente intento toma a otro cliente.
const MAX_ATTEMPTS_PER_RUN = 30;
// Hobby corta la función a los 300 s. Con el modelo colgado cada lote puede tardar más
// de un minuto: sin este tope, las campañas, seguimientos y alertas de abajo no corren.
export const maxDuration = 300;
const REPLY_BUDGET_MS = 180_000;

export async function GET(request: Request): Promise<NextResponse> {
  // Verify Vercel cron auth header
  if (!isCronAuthorized(request.headers.get("Authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ processed: boolean; error?: string }> = [];

  const startedAt = Date.now();
  // Por qué terminó la pasada: queda en la respuesta para poder medirlo.
  let stoppedBy = "limit";
  let attended = 0;
  for (let i = 0; i < MAX_ATTEMPTS_PER_RUN && attended < MAX_BATCHES_PER_RUN; i++) {
    if (Date.now() - startedAt > REPLY_BUDGET_MS) {
      stoppedBy = "budget";
      break;
    }
    const result = await processNextBatch({ deadlineAt: startedAt + (maxDuration - 20) * 1000 });
    results.push(result);

    if (result.processed) {
      attended++;
      continue;
    }
    // Sin conversación no se tomó ningún lote: la cola está vacía o falló la consulta.
    if (!result.conversationId) {
      stoppedBy = result.error ? "error" : "empty";
      break;
    }
  }

  const processedCount = results.filter((r) => r.processed).length;

  // ARM: send the next small batch of approved campaign recipients. A failure
  // here must never break the reply loop above, which already ran.
  let campaignSends = 0;
  try {
    campaignSends = await drainCampaignQueue();
  } catch (err) {
    console.error("[cron] drainCampaignQueue failed:", safeError(err));
  }

  // Automation rules (Configuración → Automatizaciones). Never throws.
  const automations = await runAutomations();

  // Messages the agent promised to send later. Never throws.
  const followUps = await runFollowUps();

  // Aprobaciones que se cortaron a mitad de camino. Un error acá no frena el resto.
  await failStaleProposals().catch((err) => console.error("[cron] failStaleProposals failed:", safeError(err)));

  // Email digest of new problems (every few minutes, with a cooldown). Never
  // throws, so it cannot break the reply loop either.
  const alerted = await checkAlerts();

  return NextResponse.json({
    ok: true,
    processed: processedCount,
    stopped_by: stoppedBy,
    campaign_sends: campaignSends,
    automations,
    follow_ups: followUps,
    alerted,
  });
}
