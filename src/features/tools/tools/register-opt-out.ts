// El cliente pidió la baja con palabras que la lista de opt-out.ts no reconoce.
//
// Esta herramienta no escribe opt_in: con la baja marcada, dispatch rechaza todo envío y la
// confirmación no saldría. Solo registra el pedido; quien termina el turno la aplica
// (applyOptOut en buffer.ts), que confirma primero y marca después.

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";
import { OPT_OUT_TOOL } from "@/features/inbox/services/opt-out";

const schema = z.object({
  quote: z.string().min(3).max(500).describe("Las palabras exactas del cliente donde pide dejar de recibir mensajes"),
});

type Args = z.infer<typeof schema>;

const DONE = {
  opt_out_requested: true,
  message: "Hecho. El sistema le manda la confirmación al cliente y no le vuelve a escribir. No agregues nada más.",
};

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  // El chat de prueba no tiene conversación: se comporta igual, sin cambiar nada.
  if (!ctx.conversationId) return { ok: true, output: { ...DONE, simulated: true } };
  const { findSourceMessage } = await import("@/features/arm/services/claims");
  if (!(await findSourceMessage(ctx.conversationId, args.quote))) {
    return { ok: false, output: null, error: "Esas palabras no están en lo que escribió el cliente." };
  }
  return { ok: true, output: DONE };
}

export const registerOptOutTool: Tool<Args> = {
  name: OPT_OUT_TOOL,
  description:
    "Da de baja al cliente: no recibe más mensajes. Usala SOLO si pide dejar de recibir mensajes para siempre, con cualquier palabra. " +
    "No la uses si pide una pausa («hoy no me escribas») o que no le manden una cosa puntual. Citá sus palabras exactas en quote.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
