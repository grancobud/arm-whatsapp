// Loads a workspace's MCP servers from the DB and turns them into the turn's
// tools (see mcp-tools.ts for the design rules).

import { createServiceClient as svc } from "@/lib/supabase/service";
import { decryptCredentials } from "@/shared/lib/integration-secrets";
import { validateWebhookUrl } from "../services/ssrf-guard";
import type { Tool } from "../core/tool";
import {
  adaptTool,
  buildMcpTools,
  listRemoteTools,
  parseMcpToolName,
  type McpServerConfig,
  type McpToolPolicy,
} from "./mcp-tools";


/** Credentials are bound to this provider id, so a blob moved between servers fails to decrypt. */
export const mcpProvider = (slug: string) => `mcp:${slug}`;

interface McpServerRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  url: string;
  credentials: Record<string, unknown> | null;
  tool_policies: Record<string, McpToolPolicy> | null;
}

async function toConfig(row: McpServerRow): Promise<McpServerConfig> {
  // Re-checked on every use: DNS can change after the server was saved.
  const ssrf = await validateWebhookUrl(row.url);
  if (ssrf) throw new Error(`URL no permitida (${ssrf})`);
  const creds = await decryptCredentials(row.credentials, row.workspace_id, mcpProvider(row.slug));
  const auth = typeof creds.authorization === "string" ? creds.authorization : "";
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    url: row.url,
    headers: auth ? { Authorization: auth } : undefined,
    policies: row.tool_policies ?? {},
  };
}

async function loadRows(workspaceId: string, slug?: string): Promise<McpServerRow[]> {
  let q = svc()
    .from("mcp_servers")
    .select("id, workspace_id, slug, name, url, credentials, tool_policies")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);
  if (slug) q = q.eq("slug", slug);
  const { data, error } = await q;
  // Before the migration is applied the table does not exist: no MCP tools.
  if (error) return [];
  return (data ?? []) as McpServerRow[];
}

function logMcpError(workspaceId: string, server: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[mcp] ${server}:`, message);
  void svc()
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "mcp_server_error",
      level: "warn",
      payload: { server, error: message.slice(0, 300) },
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** The workspace's MCP tools for this turn. Never throws: a broken server is skipped and logged. */
export async function getWorkspaceMcpTools(workspaceId: string): Promise<Tool[]> {
  const rows = await loadRows(workspaceId);
  if (rows.length === 0) return [];
  const configs: McpServerConfig[] = [];
  for (const row of rows) {
    try {
      configs.push(await toConfig(row));
    } catch (err) {
      logMcpError(workspaceId, row.slug, err);
    }
  }
  return buildMcpTools(configs, (cfg, err) => logMcpError(workspaceId, cfg.slug, err));
}

/**
 * For the approval replay: rebuilds the ONE tool a proposal named, from that
 * workspace's server. Returns null if the server or the tool is gone.
 */
export async function resolveMcpTool(workspaceId: string, toolName: string): Promise<Tool | null> {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return null;
  const [row] = await loadRows(workspaceId, parsed.slug);
  if (!row) return null;
  const cfg = await toConfig(row);
  const remote = (await listRemoteTools(cfg)).find((t) => adaptTool(cfg, t)?.name === toolName);
  return remote ? adaptTool(cfg, remote) : null;
}

/** Used by the settings screen: connects and lists the tools, with the current policy of each. */
export async function inspectMcpServer(row: McpServerRow) {
  const cfg = await toConfig(row);
  const remote = await listRemoteTools(cfg);
  return remote.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    readOnlyHint: t.readOnlyHint ?? false,
    policy: cfg.policies?.[t.name] ?? ("sensitive" as McpToolPolicy),
  }));
}
