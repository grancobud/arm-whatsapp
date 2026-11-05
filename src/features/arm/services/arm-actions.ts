"use server";

/**
 * arm-actions.ts — Server actions for the ARM: contact memory, the review queue
 * (agent proposals + campaigns awaiting approval) and campaign creation.
 *
 * Every action re-checks membership on the row's own workspace_id (IDOR class
 * from the E2E audit) before touching anything with the service-role client.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { canRevertChange } from "./contact-update-rules";
import { dispatchText } from "@/features/inbox/services/dispatch";
import { applyTransition } from "@/features/inbox/services/decision-engine";
import { approvalFollowUp } from "@/features/inbox/services/turn-recovery";
import { registry } from "@/features/tools";
import { isMcpToolName } from "@/features/tools/mcp/mcp-tools";
import { resolveMcpTool } from "@/features/tools/mcp/mcp-servers";
import { createCampaign, resolveSegment } from "./campaigns";
import type { ClaimRow } from "../types";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

// ──────────────────────────────────────────────────────────────────────────────
// Contact memory
// ──────────────────────────────────────────────────────────────────────────────

/** Claims of a contact, read through RLS (caller must be a member). */
export async function listContactClaims(
  contactId: string,
): Promise<Result<ClaimRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_claims")
    .select("*")
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: "No se pudo leer la memoria" };
  return { ok: true, data: (data ?? []) as ClaimRow[] };
}

/** Marks a claim as wrong. RLS limits it to operators of its workspace. */
export async function retractClaim(claimId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contact_claims")
    .update({ status: "retracted" })
    .eq("id", claimId);
  if (error) return { ok: false, error: "No se pudo descartar el dato" };
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lessons: what the team taught the agent
// ──────────────────────────────────────────────────────────────────────────────

export interface LessonItem {
  id: string;
  source: string;
  lesson: string;
  example: string | null;
  created_at: string;
}

/** A person corrects one of the AI's replies. Through RLS: operators only. */
export async function correctAiMessage(messageId: string, lesson: string): Promise<Result> {
  const text = lesson.trim();
  if (text.length < 3) return { ok: false, error: "Escribí qué tendría que haber hecho" };
  const supabase = await createClient();
  const { data: msg } = await supabase
    .from("messages")
    .select("id, workspace_id, body, direction, sender_user_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { ok: false, error: "Mensaje no encontrado" };
  if (msg.direction !== "out" || msg.sender_user_id) {
    return { ok: false, error: "Solo se corrigen respuestas de la IA" };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("agent_lessons").insert({
    workspace_id: msg.workspace_id,
    source: "message_correction",
    lesson: text.slice(0, 300),
    example: ((msg.body as string | null) ?? "").slice(0, 500) || null,
    message_id: messageId,
    created_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: "No se pudo guardar la corrección" };
  return { ok: true, data: null };
}

export async function listLessons(workspaceId: string): Promise<Result<LessonItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_lessons")
    .select("id, source, lesson, example, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: "No se pudieron leer las correcciones" };
  return { ok: true, data: (data ?? []) as LessonItem[] };
}

export async function archiveLesson(lessonId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("agent_lessons").update({ status: "archived" }).eq("id", lessonId);
  if (error) return { ok: false, error: "No se pudo quitar" };
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Relationship score
// ──────────────────────────────────────────────────────────────────────────────

export async function getContactRelationshipAction(
  contactId: string,
): Promise<Result<import("./relationship").Relationship | null>> {
  // Reading the contact through RLS proves the caller is a member.
  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("workspace_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { ok: false, error: "Sin acceso" };
  const { getContactRelationship } = await import("./relationship");
  const rel = await getContactRelationship(contact.workspace_id as string, contactId);
  return { ok: true, data: rel };
}

// ──────────────────────────────────────────────────────────────────────────────
// Promises the agent made (follow_ups)
// ──────────────────────────────────────────────────────────────────────────────

export interface FollowUpItem {
  id: string;
  due_at: string;
  message: string;
  reason: string | null;
  status: string;
  detail: string | null;
}

/** Follow-ups of a contact, read through RLS: pending first, then the latest. */
export async function listContactFollowUps(
  contactId: string,
): Promise<Result<FollowUpItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select("id, due_at, message, reason, status, detail")
    .eq("contact_id", contactId)
    .order("due_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: "No se pudieron leer las promesas" };
  const rows = (data ?? []) as FollowUpItem[];
  const pending = rows.filter((r) => r.status === "pending").reverse();
  return { ok: true, data: [...pending, ...rows.filter((r) => r.status !== "pending").slice(0, 5)] };
}

/** Cancels a pending follow-up. RLS limits it to operators of its workspace. */
export async function cancelFollowUp(followUpId: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .update({ status: "cancelled", detail: "cancelado por una persona", done_at: new Date().toISOString() })
    .eq("id", followUpId)
    .eq("status", "pending")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo cancelar (¿ya salió?)" };
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Review queue: agent proposals
// ──────────────────────────────────────────────────────────────────────────────

/** The agent told the customer a person would confirm: this is that answer. */
async function closeWithCustomer(
  conversationId: string | null,
  workspaceId: string,
  outcome: "done" | "failed" | "rejected",
  userId: string,
): Promise<void> {
  if (!conversationId) return;
  try {
    const { data: conv } = await svc()
      .from("conversations")
      .select("state")
      .eq("id", conversationId)
      .maybeSingle();
    const next = approvalFollowUp(outcome, conv?.state as string | undefined);
    if (next.message) {
      const sent = await dispatchText({ workspaceId, conversationId, body: next.message });
      // Past the 24 h window it can't go out: a person has to pick it up.
      if (!sent.ok) await applyTransition(conversationId, "handoff_pending", { userId, trigger: "proposal_decided" });
    }
    if (next.handoff) {
      await applyTransition(conversationId, "handoff_pending", { userId, trigger: "proposal_decided" });
    }
  } catch (err) {
    // The decision already stands; this only logs.
    console.error("[arm] closing with the customer failed:", err);
  }
}

export async function decideProposal(
  proposalId: string,
  approve: boolean,
  /** On reject: what it should have done. Saved as a lesson for the agent. */
  note?: string,
): Promise<Result> {
  const supabase = svc();
  const { data: proposal } = await supabase
    .from("agent_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) return { ok: false, error: "Propuesta no encontrada" };

  const auth = await requireWorkspaceMember(proposal.workspace_id as string, {
    minRole: "manager",
  });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para decidir" };

  // Claim the row: only one decision can win a pending proposal.
  const { data: claimed } = await supabase
    .from("agent_proposals")
    .update({
      status: approve ? "executing" : "rejected",
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "La propuesta ya fue decidida" };

  const lesson = note?.trim();
  if (!approve && lesson && lesson.length >= 3) {
    const args = JSON.stringify(proposal.args ?? {});
    await supabase.from("agent_lessons").insert({
      workspace_id: proposal.workspace_id,
      source: "rejected_proposal",
      lesson: lesson.slice(0, 300),
      example: `${proposal.tool_name ?? "acción"} ${args}`.slice(0, 500),
      proposal_id: proposalId,
      created_by: auth.userId,
    });
  }

  if (approve) {
    // Same write path as the agent: zod validation, timeout and logging live
    // in the registry; approvedProposalId lets the sensitive tool run.
    const ctx = {
      workspaceId: proposal.workspace_id as string,
      conversationId: proposal.conversation_id as string,
      contactId: proposal.contact_id as string,
    };
    const toolName = proposal.tool_name as string;
    // A workspace's MCP tool is rebuilt from THAT workspace's server; the
    // shared registry only holds the built-in tools.
    let result;
    if (isMcpToolName(toolName)) {
      const mcpTool = await resolveMcpTool(ctx.workspaceId, toolName).catch(() => null);
      result = mcpTool
        ? await registry.runTool(mcpTool, proposal.args, ctx, { approvedProposalId: proposalId })
        : { ok: false, output: null, error: "El sistema externo ya no ofrece esta acción o no responde" };
    } else {
      result = await registry.run(toolName, proposal.args, ctx, { approvedProposalId: proposalId });
    }
    await supabase
      .from("agent_proposals")
      .update({
        status: result.ok ? "executed" : "failed",
        result: { ok: result.ok, output: result.output, error: result.error },
      })
      .eq("id", proposalId);
    if (!result.ok) {
      await closeWithCustomer(proposal.conversation_id as string | null, proposal.workspace_id as string, "failed", auth.userId);
      revalidatePath("/revision");
      return { ok: false, error: result.error ?? "La acción falló" };
    }
    await closeWithCustomer(proposal.conversation_id as string | null, proposal.workspace_id as string, "done", auth.userId);
  } else {
    await closeWithCustomer(proposal.conversation_id as string | null, proposal.workspace_id as string, "rejected", auth.userId);
  }

  revalidatePath("/revision");
  return { ok: true, data: null };
}

// ──────────────────────────────────────────────────────────────────────────────
// Campaigns
// ──────────────────────────────────────────────────────────────────────────────

const SegmentSchema = z.object({
  stages: z
    .array(z.enum(["new", "engaged", "qualified", "customer", "lost"]))
    .optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  inactive_days: z.number().int().min(0).max(3650).optional(),
});

const CampaignSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1, "Poné un nombre").max(120),
  segment: SegmentSchema,
  templateId: z.string().uuid("Elegí una plantilla"),
  variables: z.array(z.string().max(200)).max(10),
});

export async function previewSegment(
  workspaceId: string,
  segment: unknown,
): Promise<Result<{ count: number; sample: string[] }>> {
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso" };
  const parsed = SegmentSchema.safeParse(segment);
  if (!parsed.success) return { ok: false, error: "Segmento inválido" };

  const contacts = await resolveSegment(workspaceId, parsed.data);
  return {
    ok: true,
    data: {
      count: contacts.length,
      sample: contacts.slice(0, 5).map((c) => c.name ?? c.phone),
    },
  };
}

export async function createCampaignAction(
  input: unknown,
): Promise<Result<{ id: string; recipientCount: number }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }
  const { workspaceId, name, segment, templateId, variables } = parsed.data;

  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso" };

  // The template must be this workspace's and approved by Meta.
  const { data: template } = await svc()
    .from("templates")
    .select("name, language, status")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!template || template.status !== "approved") {
    return { ok: false, error: "La plantilla no está aprobada por Meta" };
  }

  try {
    const created = await createCampaign({
      workspaceId,
      userId: auth.userId,
      name,
      segment,
      templateName: template.name as string,
      templateLanguage: (template.language as string) ?? "es",
      variables,
    });
    revalidatePath("/campanas");
    revalidatePath("/revision");
    return { ok: true, data: created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo crear",
    };
  }
}

/** Approving moves the campaign to "sending"; the cron drains it in batches. */
export async function decideCampaign(
  campaignId: string,
  approve: boolean,
): Promise<Result> {
  const supabase = svc();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campaña no encontrada" };

  const auth = await requireWorkspaceMember(campaign.workspace_id as string, {
    minRole: "manager",
  });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para decidir" };

  const { data: updated } = await supabase
    .from("campaigns")
    .update({
      status: approve ? "sending" : "rejected",
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "La campaña ya fue decidida" };

  revalidatePath("/revision");
  revalidatePath("/campanas");
  return { ok: true, data: null };
}

// ─────────────────────────────
// Cambios del agente en la ficha
// ─────────────────────────────

export interface ContactChangeItem {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string;
  quote: string | null;
  reverted_at: string | null;
  created_at: string;
}

/** Through RLS: only members of the contact's workspace see it. */
export async function listContactChanges(contactId: string): Promise<Result<ContactChangeItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_changes")
    .select("id, field, old_value, new_value, quote, reverted_at, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: "No se pudo leer el historial" };
  return { ok: true, data: (data ?? []) as ContactChangeItem[] };
}

/** Puts the previous value back, unless someone changed the field afterwards. */
export async function revertContactChange(changeId: string): Promise<Result> {
  const db = svc();
  const { data: change } = await db
    .from("contact_changes")
    .select("id, workspace_id, contact_id, field, old_value, new_value, reverted_at")
    .eq("id", changeId)
    .maybeSingle();
  if (!change) return { ok: false, error: "Cambio no encontrado" };
  const auth = await requireWorkspaceMember(change.workspace_id as string, { minRole: "agent" });
  if (!auth.ok) return { ok: false, error: "No tenés permiso para deshacerlo" };
  if (change.reverted_at) return { ok: false, error: "Ese cambio ya se deshizo" };

  const field = change.field as "name" | "email";
  const { data: contact } = await db
    .from("contacts")
    .select("name, email")
    .eq("id", change.contact_id)
    .eq("workspace_id", change.workspace_id)
    .maybeSingle();
  if (!contact || !canRevertChange(contact[field], change.new_value as string)) {
    return { ok: false, error: "Ese dato volvió a cambiar: revisalo a mano" };
  }

  const { error } = await db
    .from("contacts")
    .update({ [field]: change.old_value, updated_at: new Date().toISOString() })
    .eq("id", change.contact_id)
    .eq("workspace_id", change.workspace_id);
  if (error) return { ok: false, error: "No se pudo deshacer" };
  await db
    .from("contact_changes")
    .update({ reverted_at: new Date().toISOString(), reverted_by: auth.userId })
    .eq("id", changeId);
  return { ok: true, data: null };
}
