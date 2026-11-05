// Email alerts: the `events` table records every failure, but nobody was
// told. The cron calls checkAlerts(); every few minutes it looks for new
// problems and, if there are any, sends ONE digest email, then waits a
// cooldown before the next one so an outage doesn't flood the inbox.
//
// What counts as a problem: level "error" (a batch that died, a tool that
// failed, a setter evaluation that crashed) plus a few "warn" types that need
// a person (an MCP server down, the daily cost threshold). Business warnings
// (a lead knocked out, a Jev fallback) and sensitive tools held for approval
// are normal and never alert.
//
// The email carries types, counts and technical details only — never the
// content of a customer's messages — and sensitive keys are redacted.
//
// Disabled unless RESEND_API_KEY and ALERT_EMAIL_TO are set.

import { createServiceClient as svc } from "@/lib/supabase/service";
import { safeError } from "@/lib/safe-error";
import { redactSensitivePayload } from "@/features/inbox/services/observability";

/** Minutes between checks (the cron ticks every minute). */
const CHECK_EVERY_MINUTES = 5;
/** Minimum minutes between two emails. */
const COOLDOWN_MINUTES = 30;
/** How far back the first check looks when no alert was ever sent. */
const FIRST_LOOKBACK_MINUTES = 60;
const MAX_DETAIL_CHARS = 160;

// follow_up_due: a promise to a customer that only a person can keep now.
// llm_failover: the AI on the PC is down and replies come from OpenRouter.
// kb_search_failed: the agent is replying without the knowledge base.
const ALERT_WARN_TYPES = new Set(["mcp_server_error", "cost_alert", "follow_up_due", "llm_failover", "kb_search_failed"]);

export interface AlertEvent {
  workspace_id: string;
  type: string;
  level: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface AlertRow {
  workspace: string;
  type: string;
  count: number;
  detail: string;
  last: string;
}

/** Una falla suelta del revisor es normal con modelos gratis; muchas juntas dejan sin revisar todo. */
export const REVIEW_FAILURE_BURST = 5;
const REVIEW_FAILURES = new Set(["review_failed", "rewrite_failed"]);
const isReviewFailure = (e: AlertEvent) =>
  e.type === "reply_review" && REVIEW_FAILURES.has(String(e.payload?.outcome));

/** Lo que amerita un mail, contando también lo que solo importa en cantidad. */
export function alertWorthyEvents(events: AlertEvent[]): AlertEvent[] {
  const failures = events.filter(isReviewFailure);
  const burst = failures.length >= REVIEW_FAILURE_BURST ? failures : [];
  return [...events.filter(isAlertWorthy), ...burst];
}

/** True if this event needs a person to look at it. */
export function isAlertWorthy(e: AlertEvent): boolean {
  if (e.type === "alert_sent") return false;
  if (e.level === "error") {
    // A sensitive tool waiting for approval is logged as a failed call, but it
    // is the approval flow working, not a failure.
    return !(e.type === "tool_call" && e.payload?.requires_confirmation === true);
  }
  return e.level === "warn" && ALERT_WARN_TYPES.has(e.type);
}

function detailOf(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const p = redactSensitivePayload(payload);
  const pick = p.error ?? p.reason ?? p.server ?? p.tool_name;
  const text = typeof pick === "string" ? pick : JSON.stringify(p);
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
}

/** Groups the problems by workspace and type, most frequent first. */
export function buildDigest(events: AlertEvent[], workspaceNames: Record<string, string>): AlertRow[] {
  const groups = new Map<string, AlertRow>();
  for (const e of alertWorthyEvents(events)) {
    const key = `${e.workspace_id}|${e.type}`;
    const row = groups.get(key);
    if (row) {
      row.count++;
      if (e.created_at > row.last) {
        row.last = e.created_at;
        row.detail = detailOf(e.payload);
      }
    } else {
      groups.set(key, {
        workspace: workspaceNames[e.workspace_id] ?? e.workspace_id,
        type: e.type,
        count: 1,
        detail: detailOf(e.payload),
        last: e.created_at,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const TYPE_LABELS: Record<string, string> = {
  batch_dead_letter: "Mensajes sin responder (se agotaron los reintentos)",

  turn_incomplete: "Un turno se cortó después de usar una herramienta: revisá la conversación",
  tool_call: "Herramienta que falló",
  setter_evaluation: "Falló la calificación del lead",
  mcp_server_error: "Sistema externo (MCP) que no responde",
  cost_alert: "Pasó el umbral diario de costo de IA",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmail(rows: AlertRow[], appUrl: string): { subject: string; html: string } {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const subject = `⚠️ ARM WhatsApp: ${total} ${total === 1 ? "problema" : "problemas"} en ${new Set(rows.map((r) => r.workspace)).size === 1 ? rows[0].workspace : "varios clientes"}`;
  const filas = rows
    .map(
      (r) => `<tr>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.workspace)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(TYPE_LABELS[r.type] ?? r.type)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${r.count}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${esc(r.detail)}</td>
</tr>`,
    )
    .join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;color:#111">
<h2 style="margin:0 0 8px">⚠️ Hay problemas en ARM WhatsApp</h2>
<p style="margin:0 0 16px;color:#555">Resumen de lo que falló desde el último aviso. No incluye mensajes de clientes.</p>
<table style="border-collapse:collapse;font-size:14px">
<tr style="background:#f4f4f5"><th style="padding:6px 10px;text-align:left">Cliente</th><th style="padding:6px 10px;text-align:left">Qué pasó</th><th style="padding:6px 10px">Veces</th><th style="padding:6px 10px;text-align:left">Último detalle</th></tr>
${filas}
</table>
<p style="margin:16px 0 0"><a href="${esc(appUrl)}/workspaces">Abrir ARM WhatsApp</a></p>
<p style="margin:8px 0 0;color:#888;font-size:12px">El próximo aviso llega como mínimo en ${COOLDOWN_MINUTES} minutos, aunque sigan los errores.</p>
</div>`;
  return { subject, html };
}


async function sendEmail(subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM?.trim() || "ARM WhatsApp <onboarding@resend.dev>",
      to: process.env.ALERT_EMAIL_TO!.split(",").map((s) => s.trim()).filter(Boolean),
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.error("[alerts] email HTTP", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

let lastUnexpectedAt = 0;

/** Un error que ninguna ruta atrapó. Sin contenido, y como mucho un mail cada 30 minutos por instancia. */
export async function reportUnexpectedError(path: string, err: unknown, now = Date.now()): Promise<boolean> {
  console.error("[inesperado]", path.split("?")[0], safeError(err));
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_TO) return false;
  if (now - lastUnexpectedAt < COOLDOWN_MINUTES * 60_000) return false;
  lastUnexpectedAt = now;
  const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  try {
    return await sendEmail(
      "ARM: error no previsto",
      `<p>Ruta: ${escape(path.split("?")[0])}</p><p>${escape(safeError(err))}</p>`,
    );
  } catch {
    return false;
  }
}

/**
 * Called by the cron every minute. Never throws. Returns how many problems
 * were emailed (0 when disabled, off-minute, cooling down or all quiet).
 */
export async function checkAlerts(now = new Date()): Promise<number> {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_TO) return 0;
  if (now.getUTCMinutes() % CHECK_EVERY_MINUTES !== 0) return 0;
  try {
    const db = svc();
    const { data: lastSent } = await db
      .from("events")
      .select("created_at")
      .eq("type", "alert_sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = lastSent ? new Date(lastSent.created_at as string) : null;
    if (lastAt && now.getTime() - lastAt.getTime() < COOLDOWN_MINUTES * 60_000) return 0;

    const since = lastAt ?? new Date(now.getTime() - FIRST_LOOKBACK_MINUTES * 60_000);
    const { data: events } = await db
      .from("events")
      .select("workspace_id, type, level, payload, created_at")
      .in("level", ["error", "warn"])
      .gt("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);
    const worthy = alertWorthyEvents((events ?? []) as AlertEvent[]);
    if (worthy.length === 0) return 0;

    const ids = [...new Set(worthy.map((e) => e.workspace_id))];
    const { data: ws } = await db.from("workspaces").select("id, name").in("id", ids);
    const names = Object.fromEntries(((ws ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
    const rows = buildDigest(worthy, names);
    const { subject, html } = renderEmail(rows, process.env.NEXT_PUBLIC_APP_URL ?? "");
    if (!(await sendEmail(subject, html))) return 0;

    // events.workspace_id is required: one marker per workspace in the digest.
    // The newest marker starts the cooldown and the next check's window.
    await db.from("events").insert(
      ids.map((id) => ({
        workspace_id: id,
        type: "alert_sent",
        level: "info",
        payload: { problems: worthy.filter((e) => e.workspace_id === id).length },
      })),
    );
    return worthy.length;
  } catch (err) {
    console.error("[alerts] check failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
