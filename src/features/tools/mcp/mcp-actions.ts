"use server";

// Settings › MCP: connect, test and configure the workspace's MCP servers.
// Only managers; every query is scoped to the workspace (no IDOR); the URL is
// checked against SSRF and the auth header is stored encrypted.
// NOTE: a "use server" file may only export async functions (no types).

import { createServiceClient as svc } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { encryptCredentials } from "@/shared/lib/integration-secrets";
import { validateWebhookUrl } from "../services/ssrf-guard";
import { inspectMcpServer, mcpProvider } from "./mcp-servers";
import { listRemoteTools } from "./mcp-tools";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Policy = "read" | "sensitive" | "off";


const PUBLIC_COLUMNS = "id, slug, name, url, enabled, tool_policies, created_at";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
}

export async function listMcpServers(workspaceId: string) {
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return { ok: false as const, error: "No tenés acceso" };
  const { data, error } = await svc()
    .from("mcp_servers")
    .select(PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false as const, error: "No se pudieron cargar los servidores MCP" };
  return { ok: true as const, data: data ?? [] };
}

export async function addMcpServer(
  workspaceId: string,
  input: { name: string; url: string; authorization?: string },
): Promise<Result<{ id: string; tools: number }>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "Solo un manager puede conectar sistemas" };

  const name = input.name.trim().slice(0, 60);
  const slug = slugFrom(name);
  const url = input.url.trim();
  if (!name || !slug) return { ok: false, error: "Poné un nombre con letras o números" };
  const ssrf = await validateWebhookUrl(url);
  if (ssrf) return { ok: false, error: "URL no permitida: tiene que ser https y de un servidor público" };

  const authorization = input.authorization?.trim() ?? "";
  // Test BEFORE saving: a server that does not answer is not stored.
  let tools = 0;
  try {
    tools = (
      await listRemoteTools({
        id: "nuevo", slug, name, url,
        headers: authorization ? { Authorization: authorization } : undefined,
      })
    ).length;
  } catch (err) {
    return { ok: false, error: `No se pudo conectar: ${message(err)}` };
  }

  const credentials = await encryptCredentials(
    authorization ? { authorization } : {},
    workspaceId,
    mcpProvider(slug),
  );
  const { data, error } = await svc()
    .from("mcp_servers")
    .insert({ workspace_id: workspaceId, slug, name, url, credentials, created_by: auth.userId })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: error?.code === "23505" ? "Ya hay un sistema con ese nombre" : "No se pudo guardar",
    };
  }
  revalidatePath("/settings");
  return { ok: true, data: { id: data.id as string, tools } };
}

async function loadOwnRow(workspaceId: string, id: string) {
  const { data } = await svc()
    .from("mcp_servers")
    .select("id, workspace_id, slug, name, url, credentials, tool_policies")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function inspectMcpServerAction(workspaceId: string, id: string) {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false as const, error: "Solo un manager puede ver esto" };
  const row = await loadOwnRow(workspaceId, id);
  if (!row) return { ok: false as const, error: "Servidor no encontrado" };
  try {
    return { ok: true as const, data: await inspectMcpServer(row) };
  } catch (err) {
    return { ok: false as const, error: `No responde: ${message(err)}` };
  }
}

export async function setMcpToolPolicy(
  workspaceId: string,
  id: string,
  tool: string,
  policy: Policy,
): Promise<Result<null>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "Solo un manager puede cambiar permisos" };
  if (!["read", "sensitive", "off"].includes(policy)) return { ok: false, error: "Permiso inválido" };
  const row = await loadOwnRow(workspaceId, id);
  if (!row) return { ok: false, error: "Servidor no encontrado" };
  const policies = { ...((row.tool_policies as Record<string, Policy>) ?? {}), [tool.slice(0, 120)]: policy };
  const { error } = await svc()
    .from("mcp_servers")
    .update({ tool_policies: policies, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/settings");
  return { ok: true, data: null };
}

export async function setMcpServerEnabled(workspaceId: string, id: string, enabled: boolean): Promise<Result<null>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "Solo un manager puede hacer esto" };
  const { error } = await svc()
    .from("mcp_servers")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/settings");
  return { ok: true, data: null };
}

export async function deleteMcpServer(workspaceId: string, id: string): Promise<Result<null>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "Solo un manager puede hacer esto" };
  const { error } = await svc().from("mcp_servers").delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) return { ok: false, error: "No se pudo borrar" };
  revalidatePath("/settings");
  return { ok: true, data: null };
}
