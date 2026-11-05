"use server";

import { safeError } from "@/lib/safe-error";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSbClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType =
  | "first_message"
  | "inactivity_24h"
  | "window_closing"
  | "handoff_requested"
  | "lead_qualified"
  | "keyword_match";

export type ActionType =
  | "send_template"
  | "assign_agent"
  | "add_tag"
  | "close_conversation"
  | "handoff_human";

export interface AutomationRule {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function assertAdminOrManager(
  workspaceId: string,
): Promise<void | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return { error: "Sin permisos" };
  if (!["admin", "manager"].includes(member.role as string)) {
    return {
      error: "Solo admins y managers pueden gestionar automatizaciones",
    };
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  "first_message",
  "inactivity_24h",
  "window_closing",
  "handoff_requested",
  "lead_qualified",
  "keyword_match",
] as const;

const ACTION_TYPES = [
  "send_template",
  "assign_agent",
  "add_tag",
  "close_conversation",
  "handoff_human",
] as const;

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger_type: z.enum(TRIGGER_TYPES),
  trigger_config: z.record(z.string(), z.unknown()).default({}),
  action_type: z.enum(ACTION_TYPES),
  action_config: z.record(z.string(), z.unknown()).default({}),
});

// ── saveAutomationRule ────────────────────────────────────────────────────────

export async function saveAutomationRule(
  workspaceId: string,
  rule: Omit<
    AutomationRule,
    "workspace_id" | "created_at" | "updated_at" | "id"
  > & {
    id?: string;
  },
): Promise<{ data?: AutomationRule; error?: string }> {
  const authCheck = await assertAdminOrManager(workspaceId);
  if (authCheck && "error" in authCheck) return authCheck;

  const parsed = SaveSchema.safeParse(rule);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const db = svc();
  const { id, ...fields } = parsed.data;

  if (id) {
    // Update
    const { data, error } = await db
      .from("automation_rules")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) {
      console.error("[saveAutomationRule update]:", safeError(error));
      return { error: "Error al actualizar la automatización" };
    }

    revalidatePath("/settings");
    return { data: data as AutomationRule };
  }

  // Create
  const { data, error } = await db
    .from("automation_rules")
    .insert({ workspace_id: workspaceId, ...fields })
    .select()
    .single();

  if (error) {
    console.error("[saveAutomationRule create]:", safeError(error));
    return { error: "Error al crear la automatización" };
  }

  revalidatePath("/settings");
  return { data: data as AutomationRule };
}

// ── deleteAutomationRule ──────────────────────────────────────────────────────

export async function deleteAutomationRule(
  workspaceId: string,
  ruleId: string,
): Promise<{ success?: boolean; error?: string }> {
  const authCheck = await assertAdminOrManager(workspaceId);
  if (authCheck && "error" in authCheck) return authCheck;

  const idParsed = z.string().uuid().safeParse(ruleId);
  if (!idParsed.success) return { error: "ID de regla inválido" };

  const db = svc();
  const { error } = await db
    .from("automation_rules")
    .delete()
    .eq("id", ruleId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[deleteAutomationRule]:", safeError(error));
    return { error: "Error al eliminar la automatización" };
  }

  revalidatePath("/settings");
  return { success: true };
}

// ── toggleAutomationRule ──────────────────────────────────────────────────────

export async function toggleAutomationRule(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
): Promise<{ data?: AutomationRule; error?: string }> {
  const authCheck = await assertAdminOrManager(workspaceId);
  if (authCheck && "error" in authCheck) return authCheck;

  const idParsed = z.string().uuid().safeParse(ruleId);
  if (!idParsed.success) return { error: "ID de regla inválido" };

  const db = svc();
  const { data, error } = await db
    .from("automation_rules")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) {
    console.error("[toggleAutomationRule]:", safeError(error));
    return { error: "Error al actualizar la automatización" };
  }

  revalidatePath("/settings");
  return { data: data as AutomationRule };
}

// ── Template for promises outside the 24h window ─────────────────────────────

export async function getFollowUpTemplate(
  workspaceId: string,
): Promise<{ data?: string | null; error?: string }> {
  const authCheck = await assertAdminOrManager(workspaceId);
  if (authCheck && "error" in authCheck) return authCheck;
  const { data } = await svc().from("workspaces").select("settings").eq("id", workspaceId).single();
  const name = (data?.settings as { follow_up_template?: string } | null)?.follow_up_template;
  return { data: name?.trim() || null };
}

export async function saveFollowUpTemplate(
  workspaceId: string,
  templateName: string | null,
): Promise<{ success?: boolean; error?: string }> {
  const authCheck = await assertAdminOrManager(workspaceId);
  if (authCheck && "error" in authCheck) return authCheck;

  const name = templateName?.trim() || null;
  const db = svc();
  if (name) {
    const { data: tpl } = await db
      .from("templates")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", name)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (!tpl) return { error: "Esa plantilla no está aprobada" };
  }

  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = { ...((ws?.settings as Record<string, unknown> | null) ?? {}) };
  if (name) settings.follow_up_template = name;
  else delete settings.follow_up_template;
  const { error } = await db.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) return { error: "No se pudo guardar" };
  revalidatePath("/settings");
  return { success: true };
}
