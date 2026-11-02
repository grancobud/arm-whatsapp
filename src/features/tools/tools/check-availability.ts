import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  date_from: z
    .string()
    .describe("Fecha inicial del rango a consultar (ISO, ej: 2026-06-12)"),
  date_to: z.string().describe("Fecha final del rango (ISO, ej: 2026-06-19)"),
  timezone: z
    .string()
    .optional()
    .describe("Zona horaria IANA, ej: America/Mexico_City"),
  calendar_id: z
    .string()
    .optional()
    .describe(
      "ID del calendario de HighLevel (usa el del workspace si se omite)",
    ),
});

type Args = z.infer<typeof schema>;

// GHL free-slots returns an object keyed by date: { "2026-06-12": { slots: [...] }, ... }
// plus non-date keys (e.g. traceId) we must ignore.
interface FreeSlotsResponse {
  [key: string]: { slots?: string[] } | unknown;
}

function collectSlots(data: FreeSlotsResponse): string[] {
  const out: string[] = [];
  for (const value of Object.values(data)) {
    if (
      value &&
      typeof value === "object" &&
      "slots" in value &&
      Array.isArray((value as { slots?: unknown }).slots)
    ) {
      out.push(...((value as { slots: string[] }).slots ?? []));
    }
  }
  return out;
}

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getHLConfig } = await import("../../inbox/services/highlevel-client");

  const cfg = await getHLConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "HighLevel no está conectado para este workspace",
    };
  }

  const calendarId = args.calendar_id ?? cfg.calendarId;
  if (!calendarId) {
    return {
      ok: false,
      output: null,
      error: "No hay un calendario de HighLevel configurado",
    };
  }

  const startMs = Date.parse(args.date_from);
  let endMs = Date.parse(args.date_to);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, output: null, error: "Fechas inválidas" };
  }
  // Make date_to inclusive through the end of that day, so a single-day query
  // (date_from === date_to) still spans a real range instead of being empty.
  endMs = Math.max(endMs + 24 * 60 * 60 * 1000 - 1, startMs);

  const params = new URLSearchParams({
    startDate: String(startMs),
    endDate: String(endMs),
  });
  if (args.timezone) params.set("timezone", args.timezone);

  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Version: "2021-07-28",
      },
    },
  );

  if (!res.ok) {
    const err = await res.text();
    return {
      ok: false,
      output: null,
      error: `HL API error: ${res.status} ${err.slice(0, 150)}`,
    };
  }

  const data = (await res.json()) as FreeSlotsResponse;
  const slots = collectSlots(data).slice(0, 20); // cap to keep the prompt lean

  return {
    ok: true,
    output: {
      slots,
      count: slots.length,
      message:
        slots.length === 0
          ? "No hay horarios disponibles en ese rango."
          : `Hay ${slots.length} horarios disponibles.`,
    },
  };
}

export const checkAvailabilityTool: Tool<Args> = {
  name: "check_availability",
  description:
    "Consulta los horarios libres reales del calendario del negocio en un rango de fechas. " +
    "Usala SIEMPRE antes de decirle al cliente que hay o no hay lugar, y antes de agendar: nunca supongas disponibilidad. " +
    "Devuelve la lista de horarios libres (slots, en ISO con zona horaria). " +
    "Si devuelve un error, decile al cliente que no pudiste ver la agenda en este momento y ofrecé avisarle: no inventes horarios ni digas que hay lugar.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run,
};
