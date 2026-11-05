// F7: Business info loader — loads structured + free_text data to inject into system prompts.

import { createClient as createSbClient } from "@supabase/supabase-js";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface BusinessInfo {
  structured: Record<string, unknown>;
  free_text: string | null;
}

/**
 * Loads business info for a workspace from the business_info table.
 * Returns null when no record exists yet.
 */
export async function getBusinessInfo(
  workspaceId: string,
): Promise<BusinessInfo | null> {
  const supabase = svc();

  const { data, error } = await supabase
    .from("business_info")
    .select("structured, free_text")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[business-info] getBusinessInfo error:", error);
    return null;
  }

  if (!data) return null;

  return {
    structured: (data.structured as Record<string, unknown>) ?? {},
    free_text: data.free_text ?? null,
  };
}

/** Timezone when a workspace hasn't configured one. */
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** UTC offset (e.g. "-05:00") for a timezone right now. */
function offsetFor(timeZone: string, now: Date): string {
  const raw =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  // "GMT-05:00" → "-05:00"; "GMT" (UTC) → "+00:00"
  return raw.replace("GMT", "") || "+00:00";
}

/**
 * Current date/time context for the system prompt, so the agent can resolve
 * "hoy", "mañana", "esta semana" and build correct ISO times when checking
 * availability / booking. Timezone is per-workspace (defaults to Argentina).
 */
export function buildNowContext(timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const human = now.toLocaleString("es-AR", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const offset = offsetFor(timeZone, now);
  return `## Fecha actual\nHoy es ${human} (zona horaria ${timeZone}, offset ${offset}). Usa esta fecha para interpretar "hoy", "mañana", "esta semana", etc. al consultar disponibilidad o agendar. Cuando agendes, construye las horas en ISO con el offset ${offset} (ej: 2026-06-12T10:00:00${offset}), y pasa la zona horaria ${timeZone} a la herramienta de disponibilidad.\n${upcomingDays(timeZone, now)}`;
}

/**
 * La semana ya calculada. Medido con eval:produccion: con solo "hoy es martes", el
 * modelo consultó la agenda del miércoles cuando le pidieron el viernes.
 */
export function upcomingDays(timeZone: string, now: Date): string {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + (i + 1) * 86_400_000);
    const nombre = d.toLocaleDateString("es-AR", { timeZone, weekday: "long" });
    const iso = d.toLocaleDateString("en-CA", { timeZone });
    return `${nombre} ${iso}`;
  });
  return `Próximos días: ${dias.join(", ")}.`;
}

/**
 * Formats business info into a string block suitable for injection
 * at the top of an AI system prompt.
 * Returns an empty string when info is null.
 */
export function buildBusinessInfoContext(info: BusinessInfo | null): string {
  if (!info) return "";

  const lines: string[] = ["## Información del Negocio"];

  const hasStructured =
    info.structured && Object.keys(info.structured).length > 0;

  if (hasStructured) {
    lines.push(JSON.stringify(info.structured, null, 2));
  }

  if (info.free_text) {
    if (hasStructured) lines.push("");
    lines.push(info.free_text);
  }

  if (!hasStructured && !info.free_text) return "";

  return lines.join("\n");
}

/**
 * Upserts business info for a workspace.
 * Merges partial updates — only provided fields are overwritten.
 */
export async function upsertBusinessInfo(
  workspaceId: string,
  data: Partial<BusinessInfo>,
): Promise<void> {
  const supabase = svc();

  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
  };

  if (data.structured !== undefined) payload.structured = data.structured;
  if (data.free_text !== undefined) payload.free_text = data.free_text;

  const { error } = await supabase
    .from("business_info")
    .upsert(payload, { onConflict: "workspace_id" });

  if (error) {
    console.error("[business-info] upsertBusinessInfo error:", error);
    throw new Error(`Failed to upsert business info: ${error.message}`);
  }
}
