import { createServiceClient as svc } from "@/lib/supabase/service";
import { registry } from "../registry";
import type { Tool } from "../core/tool";
import { getWorkspaceMcpTools } from "../mcp/mcp-servers";
import { effectiveSensitivity, parseAutonomy } from "../lib/autonomy";
import { OPT_OUT_TOOL } from "@/features/inbox/services/opt-out";


// Respetar una baja no es una opción del negocio: no se apaga ni espera aprobación.
const ALWAYS_ON = new Set([OPT_OUT_TOOL]);

interface ToolConfigRow {
  tool: { key?: string } | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

/**
 * Returns the list of Tool instances that are enabled for a given workspace.
 * Reads the tool_configs table — if a tool has no row, it is considered disabled.
 */
export async function getEnabledTools(workspaceId: string): Promise<Tool[]> {
  const supabase = svc();

  const [{ data }, { data: ws }] = await Promise.all([
    supabase
      .from("tool_configs")
      .select("tool:tools(key), enabled, config")
      .eq("workspace_id", workspaceId)
      .eq("enabled", true),
    supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
  ]);

  const enabledKeys = new Set(
    ((data as ToolConfigRow[] | null) ?? [])
      .map((row) => row.tool?.key)
      .filter((k): k is string => typeof k === "string"),
  );

  // Graduated autonomy: the owner may have chosen "do it alone" or "propose
  // it" for a tool (see lib/autonomy.ts). The registry gates on sensitivity.
  const modes = parseAutonomy(ws?.settings);
  const builtIn = registry
    .list()
    .filter((t) => enabledKeys.has(t.name) || ALWAYS_ON.has(t.name))
    .map((t) =>
      modes[t.name] && !ALWAYS_ON.has(t.name) ? { ...t, sensitivity: effectiveSensitivity(t.sensitivity, modes[t.name]) } : t,
    );
  // Plus the tools of the workspace's own MCP servers (never throws).
  const external = await getWorkspaceMcpTools(workspaceId);
  return [...builtIn, ...external];
}
