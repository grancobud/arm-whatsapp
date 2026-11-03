import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  due_at: z
    .string()
    .describe(
      "Cuándo escribirle, en ISO con el offset de la zona del negocio (ej: 2026-11-06T10:00:00-03:00). Entre 10 minutos y 60 días desde ahora.",
    ),
  message: z
    .string()
    .min(5)
    .max(1000)
    .describe(
      "El mensaje EXACTO que se le va a mandar ese día, escrito como si lo mandaras en ese momento (ej: «¡Hola Ana! Te escribo como quedamos para confirmar el turno del sábado. ¿Te sigue sirviendo?»).",
    ),
  reason: z
    .string()
    .max(300)
    .optional()
    .describe("Qué se le prometió, en una frase, para que el equipo lo entienda"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { scheduleFollowUp } = await import("@/features/arm/services/follow-ups");
  const r = await scheduleFollowUp({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    dueAt: args.due_at,
    message: args.message,
    reason: args.reason,
  });
  if (!r.ok) return { ok: false, output: null, error: r.error };
  return {
    ok: true,
    output: {
      scheduled: true,
      due_at: r.dueAt,
      message: "Agendado. Ya le podés confirmar al cliente que le vas a escribir.",
    },
  };
}

export const scheduleFollowUpTool: Tool<Args> = {
  name: "schedule_followup",
  description:
    "Agenda un mensaje para mandarle al cliente más adelante. Usala SIEMPRE que le prometas escribirle después («te escribo el jueves», «mañana te confirmo», «te aviso cuando llegue»), en el mismo turno en que lo prometés. " +
    "Si no la usás, no lo prometas. No sirve para turnos o reservas: para eso están las herramientas de agenda.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
