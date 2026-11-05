import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  reason: z.string().max(300).describe("Qué pasó, en una frase, para que el equipo lo entienda"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const done = {
    handed_over: true,
    message:
      "Listo: la conversación quedó para el equipo. Decile que una persona lo va a atender, sin prometer cuándo.",
  };
  // El chat de prueba no tiene conversación: se comporta igual, sin cambiar nada.
  if (!ctx.conversationId) return { ok: true, output: { ...done, simulated: true } };

  const { applyTransition } = await import("@/features/inbox/services/decision-engine");
  const { canTransition } = await import("@/features/inbox/services/state-machine");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: conversation } = await db
    .from("conversations")
    .select("state")
    .eq("id", ctx.conversationId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!conversation) return { ok: false, output: null, error: "No se encontró la conversación" };

  // Si ya la tiene una persona, no hay nada que cambiar.
  if (canTransition(conversation.state, "handoff_pending")) {
    // La respuesta del agente ya le avisa al cliente: sin esto recibiría dos avisos.
    await applyTransition(ctx.conversationId, "handoff_pending", { trigger: "agent_tool", skipAck: true });
  }
  await db.from("events").insert({
    workspace_id: ctx.workspaceId,
    conversation_id: ctx.conversationId,
    type: "agent_requested_human",
    level: "info",
    payload: { reason: args.reason },
  });
  return { ok: true, output: done };
}

export const requestHumanTool: Tool<Args> = {
  name: "request_human",
  description:
    "Pasa la conversación a una persona del equipo y deja de responder la IA. Usala SIEMPRE que el cliente se queje, " +
    "esté molesto, pida hablar con alguien o quiera negociar un precio o un descuento. Si no la usás, no prometas que alguien lo va a contactar.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
