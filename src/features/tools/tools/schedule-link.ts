import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  contact_name: z
    .string()
    .optional()
    .describe("Nombre del contacto, si lo dijo"),
});

type Args = z.infer<typeof schema>;

async function run(_args: Args, ctx: ToolContext): Promise<ToolResult> {
  const supabase = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // The scheduling link is configured per workspace in tool_configs.config
  // (set from Settings → Tools → "Agendamiento (link)").
  const { data: toolRow } = await supabase
    .from("tools")
    .select("id")
    .eq("key", "schedule_link")
    .single();

  const { data: cfg } = toolRow
    ? await supabase
        .from("tool_configs")
        .select("config")
        .eq("workspace_id", ctx.workspaceId)
        .eq("tool_id", (toolRow as { id: string }).id)
        .single()
    : { data: null };

  const link = (
    (cfg as { config?: { scheduling_link?: string } } | null)?.config
      ?.scheduling_link ?? ""
  ).trim();

  if (!link) {
    return {
      ok: false,
      output: null,
      error: "No hay un link de agendamiento configurado para este workspace",
    };
  }

  return {
    ok: true,
    output: { link, message: `Aquí tienes el link para agendar: ${link}` },
  };
}

export const scheduleLinkTool: Tool<Args> = {
  name: "schedule_link",
  description:
    "Devuelve el link de agenda del negocio para que el cliente reserve solo. " +
    "Usala cuando el cliente quiera agendar una cita, reunión o llamada y no haya calendario conectado para reservar directo. " +
    "Devuelve la URL; pasásela al cliente tal cual.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run,
};
