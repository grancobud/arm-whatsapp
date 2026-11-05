"use server";

// Server actions for graduated autonomy (Configuración → Herramientas).

import { createServiceClient as svc } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { registry } from "@/features/tools";
import {
  defaultMode,
  parseAutonomy,
  trackRecord,
  type AutonomyMode,
  type TrackRecord,
} from "@/features/tools/lib/autonomy";


async function assertAdminOrManager(workspaceId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "No autenticado";
  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || !["admin", "manager"].includes(member.role as string)) {
    return "Solo admins y managers pueden cambiar la autonomía";
  }
  return null;
}

export interface ToolAutonomy {
  mode: AutonomyMode;
  isDefault: boolean;
  record: TrackRecord;
}

export async function getToolAutonomy(
  workspaceId: string,
): Promise<{ data?: Record<string, ToolAutonomy>; error?: string }> {
  const denied = await assertAdminOrManager(workspaceId);
  if (denied) return { error: denied };

  const db = svc();
  const [{ data: ws }, { data: proposals }] = await Promise.all([
    db.from("workspaces").select("settings").eq("id", workspaceId).single(),
    db
      .from("agent_proposals")
      .select("tool_name, status")
      .eq("workspace_id", workspaceId)
      .eq("kind", "tool_call")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const modes = parseAutonomy(ws?.settings);
  const byTool = new Map<string, string[]>();
  for (const p of (proposals ?? []) as Array<{ tool_name: string; status: string }>) {
    byTool.set(p.tool_name, [...(byTool.get(p.tool_name) ?? []), p.status]);
  }

  const out: Record<string, ToolAutonomy> = {};
  for (const tool of registry.list()) {
    const mode = modes[tool.name] ?? defaultMode(tool.sensitivity);
    out[tool.name] = {
      mode,
      isDefault: !modes[tool.name],
      record: trackRecord(byTool.get(tool.name) ?? [], mode),
    };
  }
  return { data: out };
}

export async function setToolAutonomy(
  workspaceId: string,
  toolKey: string,
  mode: AutonomyMode,
): Promise<{ success?: boolean; error?: string }> {
  const denied = await assertAdminOrManager(workspaceId);
  if (denied) return { error: denied };
  if (!registry.get(toolKey)) return { error: "Herramienta desconocida" };
  if (mode !== "auto" && mode !== "propose") return { error: "Modo inválido" };

  const db = svc();
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = { ...((ws?.settings as Record<string, unknown> | null) ?? {}) };
  settings.tool_autonomy = { ...parseAutonomy(settings), [toolKey]: mode };
  const { error } = await db.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) return { error: "No se pudo guardar" };

  await db.from("events").insert({
    workspace_id: workspaceId,
    type: "autonomy_change",
    level: "info",
    payload: { tool: toolKey, mode },
  });
  revalidatePath("/settings");
  return { success: true };
}
