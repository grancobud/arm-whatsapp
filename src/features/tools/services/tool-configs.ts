import { createClient as createSbClient } from "@supabase/supabase-js";
import { registry } from "../registry";
import type { Tool } from "../core/tool";
import { getWorkspaceMcpTools } from "../mcp/mcp-servers";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

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

  const { data } = await supabase
    .from("tool_configs")
    .select("tool:tools(key), enabled, config")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  const enabledKeys = new Set(
    ((data as ToolConfigRow[] | null) ?? [])
      .map((row) => row.tool?.key)
      .filter((k): k is string => typeof k === "string"),
  );

  const builtIn = registry.list().filter((t) => enabledKeys.has(t.name));
  // Plus the tools of the workspace's own MCP servers (never throws).
  const external = await getWorkspaceMcpTools(workspaceId);
  return [...builtIn, ...external];
}
