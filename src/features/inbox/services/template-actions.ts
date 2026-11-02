"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { listTemplates } from "./templates";
import { dispatchTemplate } from "./dispatch";
// NOTE: do NOT re-export types from a "use server" file — Next/Turbopack treats
// every export of an action module as an async action, and a re-exported type
// becomes an undefined runtime reference that crashes the whole actions chunk.
// Consumers import TemplateRow directly from "./templates".
import type { TemplateRow } from "./templates";

// ──────────────────────────────────────────────────────────────────────────────
// getApprovedTemplates
// ──────────────────────────────────────────────────────────────────────────────

export async function getApprovedTemplates(
  workspaceId: string,
): Promise<TemplateRow[]> {
  // listTemplates uses the service-role client: check membership first.
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return [];
  return listTemplates(workspaceId, "approved");
}

// ──────────────────────────────────────────────────────────────────────────────
// sendTemplateAction
// ──────────────────────────────────────────────────────────────────────────────

export async function sendTemplateAction(
  workspaceId: string,
  conversationId: string,
  templateName: string,
  language: string,
  variables: string[],
): Promise<{ ok: boolean; error?: string }> {
  // dispatchTemplate runs with the service role and loads the conversation by id
  // alone, so both checks belong here: the caller can send from this workspace,
  // and the conversation is one of its own (not another tenant's contact).
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "agent" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para enviar plantillas" };

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "Conversación no encontrada" };

  const components =
    variables.length > 0
      ? [
          {
            type: "body" as const,
            parameters: variables.map((v) => ({
              type: "text" as const,
              text: v,
            })),
          },
        ]
      : undefined;

  const result = await dispatchTemplate({
    workspaceId,
    conversationId,
    templateName,
    templateLanguage: language,
    components,
    senderUserId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Error enviando template" };
  }

  return { ok: true };
}
