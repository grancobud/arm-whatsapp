import { inboundMessageText } from "./inbound-text";
import { resolveCitations } from "./kb-citations";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createReviewCompleter, generateWithTools, getWorkspaceModel } from "./openrouter";
import { DEFAULT_REVIEW_BUDGET_MS, reviewEnabled, reviewReply } from "./reply-review";
import { backHandoffPromise, withHandoffNotice } from "./handoff-promise";
import { backContactData, dropNameFromEmail } from "./contact-capture";
import { removeBookingOffer } from "./booking-offer";
import { recordLlmUsage } from "./cost-tracker";
import { dispatchText, dispatchTemplate } from "./dispatch";
import { decide, applyTransition } from "./decision-engine";
import { applyJevToBatch } from "@/features/jev-judge/apply";
import type { ToolContext } from "@/features/tools/core/tool";
import { resolveSystemPrompt } from "./prompt-resolver";
import { buildSystemPrompt } from "./prompt-builder";
import { getLessonsContext } from "@/features/arm/services/lessons";
import {
  getActiveClaims,
  formatClaimsContext,
} from "@/features/arm/services/claims";
import { getActiveAgent } from "@/features/agents/services/active-agent";
import { maybeAutoProcess } from "@/features/agents/services/auto-tagging";
import {
  getBusinessInfo,
  buildBusinessInfoContext,
  buildNowContext,
  DEFAULT_TIMEZONE,
} from "./business-info";
import {
  searchKb,
  formatKbContext,
  listKbSourceLinks,
  formatKbReferenceLinks,
} from "./kb-service";
import { enforceCostPolicy, buildCostAwareSystemPrompt } from "./cost-enforcer";
import {
  getConversationHistory,
  type ConversationTurn,
} from "./conversation-history";
import { getSetterConfig, evaluateLead } from "./setter";
import {
  BUSY_RETRY_MS,
  capInbound,
  formatPendingActions,
  isRunningElsewhere,
  turnRecovery,
  type TurnProgress,
} from "./turn-recovery";
import { syncContactToHL, createHLOpportunity } from "./highlevel-client";

const DEFAULT_SILENCE_MS = 30_000; // 30 seconds silence window

// ──────────────────────────────────────────────────────────────────────────────
// Internal types
// ──────────────────────────────────────────────────────────────────────────────

interface MessageBatch {
  id: string;
  workspace_id: string;
  conversation_id: string;
  status: "buffering" | "flushed" | "processing" | "cancelled";
  silence_ms: number;
  flush_at: string;
  message_count: number;
  merged_text: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BatchMessage {
  id: string;
  body: string | null;
  meta: Record<string, unknown> | null;
  type: string;
  created_at: string;
}

interface Integration {
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface ProcessBatchResult {
  processed: boolean;
  conversationId?: string;
  error?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Service-role Supabase client — only used inside services/, never in routes
// ──────────────────────────────────────────────────────────────────────────────
function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// upsertBatch
// Creates a new buffering batch for a conversation, or extends an existing one.
// On extend: push flush_at forward by silence_ms, increment message_count, link msg.
// On create: insert batch, then link message.
// Returns the batch ID.
// ──────────────────────────────────────────────────────────────────────────────
export async function upsertBatch(opts: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  silenceMs?: number;
}): Promise<string> {
  const {
    workspaceId,
    conversationId,
    messageId,
    silenceMs = DEFAULT_SILENCE_MS,
  } = opts;
  const supabase = svc();

  // 1. Look for an active buffering batch for this conversation
  const { data: existing } = await supabase
    .from("message_batches")
    .select("id, message_count, flush_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("status", "buffering")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let batchId: string;

  if (existing) {
    // Extend: push flush_at forward and increment count
    const newFlushAt = new Date(Date.now() + silenceMs).toISOString();
    const { error: updateError } = await supabase
      .from("message_batches")
      .update({
        flush_at: newFlushAt,
        message_count: existing.message_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", "buffering"); // Guard: only extend if still buffering

    if (updateError) {
      console.error("[buffer] extend batch error:", updateError);
      throw new Error(`Failed to extend batch: ${updateError.message}`);
    }

    batchId = existing.id as string;
  } else {
    // Create a new buffering batch
    const flushAt = new Date(Date.now() + silenceMs).toISOString();
    const { data: created, error: insertError } = await supabase
      .from("message_batches")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        status: "buffering",
        silence_ms: silenceMs,
        flush_at: flushAt,
        message_count: 1,
        meta: {},
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error("[buffer] create batch error:", insertError);
      throw new Error(`Failed to create batch: ${insertError?.message}`);
    }

    batchId = created.id as string;
  }

  // 2. Link the message to the batch
  const { error: linkError } = await supabase
    .from("messages")
    .update({ batch_id: batchId })
    .eq("id", messageId);

  if (linkError) {
    // Non-fatal: batch still works; log and continue
    console.warn("[buffer] failed to link message to batch:", linkError);
  }

  return batchId;
}

// ──────────────────────────────────────────────────────────────────────────────
// consolidateBatch (private)
// Fetches all inbound messages for a batch and joins them into a single string.
// Audio transcripts / image captions use media->>'transcript' / media->>'caption'
// when present; otherwise falls back to body text. (Multi-modal extended in F8.)
// ──────────────────────────────────────────────────────────────────────────────
async function consolidateBatch(
  batchId: string,
  supabase: ReturnType<typeof svc>,
): Promise<string> {
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id, body, meta, type, created_at")
    .eq("batch_id", batchId)
    .eq("direction", "in")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`[buffer] consolidateBatch fetch error: ${error.message}`);
  }

  const lines = (msgs as BatchMessage[]).map(inboundMessageText);

  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────────
// processNextBatch (exported)
// Called by the cron job (/api/cron/buffer-flush) or the internal trigger.
//
// Flow:
//   1. claim_next_batch() RPC — atomic, uses FOR UPDATE SKIP LOCKED
//   2. No batch available → return { processed: false }
//   3. consolidateBatch → mergedText
//   4. Load conversation (ai_enabled, workspace_id, contact info)
//   5. checkRateLimits
//   6. generateReply with consolidated text
//   7. recordLlmUsage
//   8. sendText via ycloud-client (or insert dev_mode outbound)
//   9. Mark batch 'processed', persist merged_text
//  10. On error: turnRecovery decides from what the turn already did (retry,
//      finish, hand to a person or give up); see turn-recovery.ts
// ──────────────────────────────────────────────────────────────────────────────
export async function processNextBatch(opts?: {
  /** Epoch ms by which the turn must be done (the caller's function limit). */
  deadlineAt?: number;
}): Promise<ProcessBatchResult> {
  const supabase = svc();

  // ── 1. Claim one ready batch atomically ───────────────────────────────────
  const { data: claimedRows, error: claimError } =
    await supabase.rpc("claim_next_batch");

  if (claimError) {
    console.error("[buffer] claim_next_batch RPC error:", claimError);
    return { processed: false, error: claimError.message };
  }

  const batch = (claimedRows as MessageBatch[] | null)?.[0] ?? null;

  // ── 2. Nothing to process ─────────────────────────────────────────────────
  if (!batch) {
    return { processed: false };
  }

  // One turn at a time per conversation: a message that arrives while a reply is
  // being written opens a new batch, and two replies at once would overlap.
  const { data: running } = await supabase
    .from("message_batches")
    .select("updated_at")
    .eq("conversation_id", batch.conversation_id)
    .eq("status", "processing")
    .neq("id", batch.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (running && isRunningElsewhere(running.updated_at as string)) {
    await supabase
      .from("message_batches")
      .update({
        status: "buffering",
        flush_at: new Date(Date.now() + BUSY_RETRY_MS).toISOString(),
      })
      .eq("id", batch.id)
      .eq("status", "processing");
    return { processed: false, conversationId: batch.conversation_id };
  }

  const retryCount = (batch.meta?.retry_count as number | undefined) ?? 0;

  // Progress lives in the batch: if this function dies, the next run reads it.
  let meta: Record<string, unknown> = {
    ...batch.meta,
    attempts: ((batch.meta?.attempts as number | undefined) ?? 0) + 1,
  };
  const saveProgress = async (patch: TurnProgress) => {
    meta = { ...meta, ...patch };
    await supabase.from("message_batches").update({ meta }).eq("id", batch.id);
  };

  try {
    await saveProgress({});

    // A previous run already got this far: don't start over.
    const previous = turnRecovery({ ...(batch.meta as TurnProgress), attempts: meta.attempts as number });
    if (previous === "finish") {
      await markBatchProcessed(batch.id, batch.merged_text ?? "", supabase);
      return { processed: true, conversationId: batch.conversation_id };
    }
    if (previous === "hand_to_person") {
      throw new Error("El turno anterior se cortó después de usar una herramienta o de empezar a enviar");
    }
    if (previous === "give_up") {
      throw new Error("El turno se cortó demasiadas veces");
    }

    // ── 3. Consolidate messages into one string ──────────────────────────────
    const mergedText = capInbound(await consolidateBatch(batch.id, supabase));

    // ── 4. Load conversation record ─────────────────────────────────────────
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, workspace_id, contact_id, ai_enabled, summary")
      .eq("id", batch.conversation_id)
      .single();

    if (convError || !conversation) {
      throw new Error(`Conversation not found: ${convError?.message}`);
    }

    // ── 5. Decision engine: state check + handoff trigger + rate limits ──────
    const decisionResult = await decide({
      workspaceId: batch.workspace_id,
      conversationId: batch.conversation_id,
      mergedText,
      contactId: conversation.contact_id as string,
    });

    const { decision, reason } = decisionResult;

    if (decision !== "respond") {
      console.info("[buffer] not responding:", decision, reason);
      await markBatchProcessed(batch.id, mergedText, supabase);
      return { processed: true, conversationId: batch.conversation_id };
    }

    // Jev runs only after state, keyword handoff and rate limit already passed.
    // A failure falls through to the existing reply. It never downgrades customer.
    const jev = await applyJevToBatch(supabase, {
      workspaceId: batch.workspace_id,
      conversationId: batch.conversation_id,
      contactId: conversation.contact_id as string,
      mergedText,
    });
    if (jev.suppressReply) {
      await markBatchProcessed(batch.id, mergedText, supabase);
      return { processed: true, conversationId: batch.conversation_id };
    }

    // ── 6. Build ToolContext (SEC-01: anchored server-side, never from client) ─
    const toolCtx: ToolContext = {
      workspaceId: batch.workspace_id,
      conversationId: batch.conversation_id,
      contactId: conversation.contact_id as string,
    };

    // ── 6b. Resolve conversational memory window (WS2: configurable) ─────────
    // The YCloud integration config carries message_history_window; clamp to
    // [5, 50] and default to 10 when unset or non-numeric.
    const { data: ycloudCfg } = await supabase
      .from("integrations")
      .select("config")
      .eq("workspace_id", batch.workspace_id)
      .eq("provider", "ycloud")
      .eq("enabled", true)
      .maybeSingle();
    const rawWindow = Number(
      (ycloudCfg?.config as { message_history_window?: number } | null)
        ?.message_history_window,
    );
    const historyWindow = Number.isFinite(rawWindow)
      ? Math.min(50, Math.max(5, rawWindow))
      : 10;

    // ── 6c + 7. Carga concurrente (Paralelización): memoria, agente, negocio y KB ──
    const [history, activeAgent, businessInfo, kbResults, kbLinks, claims, lessonsContext] =
      await Promise.all([
        getConversationHistory(batch.conversation_id, {
          limit: historyWindow,
          excludeBatchId: batch.id,
        }),
        getActiveAgent(batch.workspace_id),
        getBusinessInfo(batch.workspace_id),
        searchKb(batch.workspace_id, mergedText, 3),
        listKbSourceLinks(batch.workspace_id),
        getActiveClaims(batch.workspace_id, conversation.contact_id as string),
        getLessonsContext(batch.workspace_id),
      ]);

    const { data: pendingProposals } = await supabase
      .from("agent_proposals")
      .select("tool_name, args")
      .eq("conversation_id", batch.conversation_id)
      .eq("status", "pending")
      .limit(5);
    const pendingActions = formatPendingActions(
      (pendingProposals ?? []) as { tool_name: string; args: unknown }[],
    );

    const resolvedPrompt = await resolveSystemPrompt(
      batch.workspace_id,
      activeAgent ? { mode: activeAgent.type } : {},
    );

    const kbContext = [
      formatKbContext(kbResults),
      formatKbReferenceLinks(kbLinks),
    ]
      .filter(Boolean)
      .join("\n\n");
    const bizContext = buildBusinessInfoContext(businessInfo);
    const memoryContext = formatClaimsContext(claims);
    const promptBase =
      resolvedPrompt?.body ??
      "Eres un asistente de WhatsApp. Responde de forma concisa y útil en español.";
    const structured = businessInfo?.structured as {
      timezone?: string;
      name?: string;
    } | null;
    const tz = structured?.timezone ?? DEFAULT_TIMEZONE;
    // WS1: surface the rolling conversation summary so the model keeps long-term
    // context beyond the recent-message window.
    const summary =
      typeof conversation.summary === "string"
        ? conversation.summary.trim()
        : "";
    // Canonical assembly (shared with the test-chat playground) — includes the
    // response style, KB and the strict rules/restrictions guardrails.
    const fullSystemPrompt = buildSystemPrompt({
      nowContext: buildNowContext(tz),
      bizContext,
      promptBase,
      summary,
      lessonsContext,
      pendingActions,
      memoryContext,
      kbContext,
      responseStyle: activeAgent?.config.responseStyle ?? null,
      guardrails: resolvedPrompt?.guardrails ?? null,
      toolNames: (decisionResult.availableTools ?? []).map((t) => t.name),
      vars: {
        agentName: activeAgent?.name ?? null,
        businessName: structured?.name ?? null,
        contactName: null,
      },
    });

    // ── 7b. SEC-06: enforce cost policy before calling LLM ───────────────────
    const costPolicy = await enforceCostPolicy(batch.workspace_id);
    const { systemPrompt: finalSystemPrompt, model: costModel } =
      await buildCostAwareSystemPrompt(
        batch.workspace_id,
        fullSystemPrompt,
        costPolicy.policy,
      );

    if (costPolicy.policy === "cut") {
      console.warn(
        "[buffer] SEC-06 cost cut — aborting AI for workspace",
        batch.workspace_id,
      );
      await markBatchProcessed(batch.id, mergedText, supabase);
      return { processed: true, conversationId: batch.conversation_id };
    }

    // ── 8. Generate AI reply with tool-calling support ───────────────────────
    // Resolve workspace model (falls back to env default or gpt-4o-mini).
    // costModel from SEC-06 takes priority when cost policy is degraded.
    const workspaceModel = await getWorkspaceModel(batch.workspace_id);
    const model = costModel ?? workspaceModel;

    const reply = await generateWithTools({
      systemPrompt: finalSystemPrompt,
      model,
      userMessage: mergedText,
      workspaceId: batch.workspace_id,
      availableTools: decisionResult.availableTools,
      toolContext: toolCtx,
      history,
      temperature: activeAgent?.config.temperature,
      deadlineAt: opts?.deadlineAt,
      onSideEffect: async () => {
        if (!meta.side_effects) await saveProgress({ side_effects: true });
      },
    });

    // ── 8a. A promised or needed handoff has to happen, whatever the model did ──
    // Before the review, so it sees the promise backed instead of rewriting it.
    const forcedHandoff = await backHandoffPromise({
      text: reply.text,
      tools: decisionResult.availableTools,
      results: reply.toolResults,
      ctx: toolCtx,
      customerText: mergedText,
    });
    if (forcedHandoff) {
      reply.toolResults.push(forcedHandoff);
      if (forcedHandoff.status === "ok") reply.text = withHandoffNotice(reply.text);
      if (!meta.side_effects) await saveProgress({ side_effects: true });
    }
    // Lo que el cliente dijo clarito queda en la ficha aunque el modelo se olvide.
    const savedContactData = await backContactData({
      customerText: mergedText,
      tools: decisionResult.availableTools,
      results: reply.toolResults,
      ctx: toolCtx,
    });
    if (savedContactData.length > 0) {
      reply.toolResults.push(...savedContactData);
      if (!meta.side_effects) await saveProgress({ side_effects: true });
    }

    // ── 8b. Reply review (evaluador-optimizador, reply-review.ts) ───────────
    // A second call checks the draft against everything the agent had; a
    // claim with no source gets one text-only rewrite. Fails open: on any
    // problem the draft goes out as is.
    let replyText = reply.text;
    let citedIds = reply.citedIds;
    let reviewIn = 0;
    let reviewOut = 0;
    // Leave time to send: with less than ~8 s left the draft goes out unreviewed.
    const reviewBudget = opts?.deadlineAt
      ? Math.min(DEFAULT_REVIEW_BUDGET_MS, opts.deadlineAt - Date.now() - 5_000)
      : DEFAULT_REVIEW_BUDGET_MS;
    if (reviewEnabled() && reply.text && reviewBudget >= 3_000) {
      try {
        const review = await reviewReply({
          budgetMs: reviewBudget,
          draft: reply.text,
          customerMessage: mergedText,
          agentSystemPrompt: finalSystemPrompt,
          sources: {
            business: bizContext,
            knowledge: kbContext,
            memory: memoryContext,
            toolResults: reply.toolResults,
            toolNames: (decisionResult.availableTools ?? []).map((t) => t.name),
          },
          complete: await createReviewCompleter(batch.workspace_id, model),
        });
        replyText = review.text;
        // The rewrite's own citations: the draft's may no longer apply.
        if (review.outcome === "rewritten" || review.outcome === "unresolved") citedIds = review.citedIds ?? [];
        reviewIn = review.inputTokens;
        reviewOut = review.outputTokens;
        if (review.outcome !== "approved") {
          await supabase.from("events").insert({
            type: "reply_review",
            level: review.outcome === "rewritten" ? "info" : "warn",
            workspace_id: batch.workspace_id,
            conversation_id: batch.conversation_id,
            payload: {
              outcome: review.outcome,
              problems: review.problems,
              error: review.error ?? null,
              draft: review.text !== reply.text ? reply.text.slice(0, 1000) : undefined,
            },
          });
        }
      } catch (err) {
        console.error("[buffer] reply review failed, sending the draft:", err);
      }
    }

    // ── 8c. Lo último que ve el texto, también si el revisor lo reescribió ──
    replyText = dropNameFromEmail(replyText, mergedText);
    const withoutOffer = removeBookingOffer(
      replyText,
      (decisionResult.availableTools ?? []).map((t) => t.name),
      mergedText,
    );
    if (withoutOffer.changed) {
      await supabase.from("events").insert({
        type: "reply_guard",
        level: "info",
        workspace_id: batch.workspace_id,
        conversation_id: batch.conversation_id,
        payload: { guard: "booking_offer_removed", draft: replyText.slice(0, 1000) },
      });
      replyText = withoutOffer.text;
    }

    // Which KB fragments the reply says it used (shown in the inbox).
    const kbSources = resolveCitations(citedIds, kbResults);

    // ── 8. Record LLM usage ──────────────────────────────────────────────────
    await recordLlmUsage({
      workspaceId: batch.workspace_id,
      conversationId: batch.conversation_id,
      contactId: conversation.contact_id as string,
      model,
      // The review is part of the turn's cost: the cost cap must see it.
      promptTokens: reply.inputTokens + reviewIn,
      completionTokens: reply.outputTokens + reviewOut,
    });

    // ── 9. Load YCloud integration credentials ──────────────────────────────
    const { data: integration, error: intError } = await supabase
      .from("integrations")
      // Only an existence check — dispatchText() loads and decrypts the
      // credentials itself, so there is no reason to pull secrets here.
      .select("workspace_id")
      .eq("workspace_id", batch.workspace_id)
      .eq("provider", "ycloud")
      .eq("enabled", true)
      .single();

    if (intError || !integration) {
      throw new Error(`YCloud integration not found: ${intError?.message}`);
    }

    // ── 10a. Dispatch via single exit point (SEC-04) ────────────────────────
    await saveProgress({ send_started: true });
    const dispatchResult = await dispatchText({
      workspaceId: batch.workspace_id,
      conversationId: batch.conversation_id,
      body: replyText,
      // AI-generated: no senderUserId
      meta: kbSources.length ? { kb_sources: kbSources } : undefined,
    });

    if (dispatchResult.ok) {
      await saveProgress({ reply_sent: true });
    } else {
      console.error("[buffer] dispatchText failed:", dispatchResult.error);
      await supabase.from("events").insert({
        type: "dispatch_failure",
        level: "error",
        workspace_id: batch.workspace_id,
        conversation_id: batch.conversation_id,
        payload: {
          error: dispatchResult.error,
          channel: "whatsapp",
        },
      });
    }

    // ── 10b. Mark batch as processed ────────────────────────────────────────
    await markBatchProcessed(batch.id, mergedText, supabase);

    // ── 10c. v1.5 opt-in: AI auto-tagging + summary (encadenamiento protegido) ──
    // Await it so serverless runtimes don't terminate the process before
    // summary/tags persist. Isolated in try/catch so it never breaks the turn.
    if (
      activeAgent &&
      (activeAgent.config.autoTag || activeAgent.config.summarize)
    ) {
      try {
        await maybeAutoProcess({
          workspaceId: batch.workspace_id,
          conversationId: batch.conversation_id,
          contactId: conversation.contact_id as string,
          config: activeAgent.config,
        });
      } catch (err) {
        console.error(
          "[buffer] auto-tagging/summary error:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── 10d. F1: Setter qualification (only when the active agent is a setter) ─
    // The user-facing reply was already dispatched above, so this adds no latency
    // to the turn. We AWAIT it (not fire-and-forget) so the post_action reliably
    // runs even if the serverless function is frozen right after the batch. It is
    // fully try/catched internally and never throws into the batch path. Dormant
    // unless an enabled setter_config exists for the workspace.
    if (!jev.ownsStage && activeAgent?.type === "setter") {
      await runSetterEvaluation({
        workspaceId: batch.workspace_id,
        conversationId: batch.conversation_id,
        contactId: conversation.contact_id as string,
        history,
        mergedText,
      });
    }

    return { processed: true, conversationId: batch.conversation_id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[buffer] processNextBatch error:", {
      batchId: batch.id,
      retryCount,
      error: errorMsg,
    });

    // ── 10. Dead-letter: increment retry or cancel ───────────────────────────
    const newRetryCount = retryCount + 1;
    const recovery = turnRecovery(meta as TurnProgress);

    if (recovery === "finish") {
      // The customer has the reply: running it again would send it twice.
      await markBatchProcessed(batch.id, batch.merged_text ?? "", supabase);
      return { processed: true, conversationId: batch.conversation_id };
    }

    if (recovery === "hand_to_person") {
      // A tool ran (or may have) and there's no reply. Repeating could book the
      // same slot twice, so a person takes over; they see what happened.
      await supabase.rpc("cancel_batch", { p_batch_id: batch.id });
      await supabase.from("events").insert({
        type: "turn_incomplete",
        level: "error",
        workspace_id: batch.workspace_id,
        conversation_id: batch.conversation_id,
        payload: { batch_id: batch.id, error: errorMsg },
      });
      await applyTransition(batch.conversation_id, "handoff_pending", {
        trigger: "turn_incomplete",
      }).catch((e) => console.error("[buffer] handoff after cut turn failed:", e));
      return { processed: false, conversationId: batch.conversation_id, error: errorMsg };
    }

    if (recovery === "give_up") {
      // Mark dead-letter via RPC
      await supabase.rpc("cancel_batch", { p_batch_id: batch.id });

      // Log to events table for observability
      await supabase.from("events").insert({
        type: "batch_dead_letter",
        level: "error",
        workspace_id: batch.workspace_id,
        conversation_id: batch.conversation_id,
        payload: {
          batch_id: batch.id,
          retry_count: newRetryCount,
          error: errorMsg,
        },
      });

      return {
        processed: false,
        conversationId: batch.conversation_id,
        error: `Batch cancelled after ${meta.attempts} attempts: ${errorMsg}`,
      };
    }

    // Revert to 'buffering' with incremented retry count so it gets picked up again
    // Use a short backoff: flush_at = now + 30s * retry_count
    const backoffMs = 30_000 * newRetryCount;
    await supabase
      .from("message_batches")
      .update({
        status: "buffering",
        flush_at: new Date(Date.now() + backoffMs).toISOString(),
        updated_at: new Date().toISOString(),
        meta: {
          ...meta,
          retry_count: newRetryCount,
          last_error: errorMsg,
        },
      })
      .eq("id", batch.id)
      .eq("status", "processing");

    return {
      processed: false,
      conversationId: batch.conversation_id,
      error: errorMsg,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// markBatchProcessed (private)
// Sets status = 'processed' and persists the merged_text for audit.
// ──────────────────────────────────────────────────────────────────────────────
async function markBatchProcessed(
  batchId: string,
  mergedText: string,
  supabase: ReturnType<typeof svc>,
): Promise<void> {
  const { error } = await supabase
    .from("message_batches")
    .update({
      status: "processed",
      merged_text: mergedText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  if (error) {
    console.error("[buffer] markBatchProcessed error:", error);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// F1: Setter qualification (private, fire-and-forget)
// Scores the lead with the setter engine and, on qualification, runs the
// configured post_action. Only invoked when the active agent is a setter.
// Dormant unless an enabled setter_config exists. Never throws into the batch
// path — all failures are caught and logged as events.
// ──────────────────────────────────────────────────────────────────────────────

interface SetterEvalParams {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  history: ConversationTurn[];
  mergedText: string;
}

async function runSetterEvaluation(params: SetterEvalParams): Promise<void> {
  const { workspaceId, conversationId, contactId, history, mergedText } =
    params;
  const supabase = svc();

  try {
    const cfg = await getSetterConfig(workspaceId);
    if (!cfg) return; // no enabled setter config → dormant

    // Load contact for the idempotency guard + tag merge in one read.
    const { data: contactRow } = await supabase
      .from("contacts")
      .select("tags, custom_fields, stage")
      .eq("id", contactId)
      .maybeSingle();

    const customFields =
      (contactRow?.custom_fields as Record<string, unknown> | null) ?? {};

    // Idempotency: stop re-evaluating once the lead reached a terminal outcome.
    if (
      customFields.lead_qualified === true ||
      customFields.setter_knocked_out === true
    ) {
      return;
    }

    // Cost debounce: re-evaluate at most every 2 user turns (always the first
    // time). Bounds setter LLM spend on chatty leads that haven't qualified yet
    // — the setter path is not gated by the main reply's rate/cost limits.
    const userTurns = history.filter((t) => t.role === "user").length + 1;
    const lastEvalTurns =
      typeof customFields.setter_eval_turns === "number"
        ? customFields.setter_eval_turns
        : 0;
    if (lastEvalTurns > 0 && userTurns - lastEvalTurns < 2) return;

    // Build the transcript string from the already-loaded history + current turn.
    const transcript =
      history.map((t) => `${t.role}: ${t.content}`).join("\n") +
      `\nuser: ${mergedText}`;

    const evaluation = await evaluateLead(cfg, transcript);

    // Persist score/qualified/summary on the contact (no migration needed).
    const nextCustomFields = {
      ...customFields,
      lead_score: evaluation.score,
      lead_qualified: evaluation.qualified,
      lead_summary: evaluation.summary,
      setter_knocked_out: evaluation.knocked_out,
      setter_knockout_reason: evaluation.knockout_reason ?? null,
      setter_config_id: cfg.id,
      setter_evaluated_at: new Date().toISOString(),
      setter_eval_turns: userTurns,
    };

    const update: Record<string, unknown> = { custom_fields: nextCustomFields };
    // Move the CRM stage on a terminal outcome — but never downgrade a customer.
    const currentStage = contactRow?.stage as string | undefined;
    if (currentStage !== "customer") {
      if (evaluation.knocked_out) update.stage = "lost";
      else if (evaluation.qualified) update.stage = "qualified";
    }
    await supabase.from("contacts").update(update).eq("id", contactId);

    // Observability event (surfaces in the conversation timeline).
    await supabase.from("events").insert({
      type: "setter_evaluation",
      level: evaluation.knocked_out ? "warn" : "info",
      workspace_id: workspaceId,
      conversation_id: conversationId,
      payload: {
        score: evaluation.score,
        qualified: evaluation.qualified,
        knocked_out: evaluation.knocked_out,
        knockout_reason: evaluation.knockout_reason ?? null,
        summary: evaluation.summary,
        config_id: cfg.id,
        contact_id: contactId,
        post_action_type: (cfg.post_action as { type?: string }).type ?? null,
      },
    });

    // Execute the post_action only for a qualified lead (the configured "win"
    // action). Knocked-out leads are marked 'lost' above; we do not fire the
    // qualify-action on them.
    if (evaluation.qualified) {
      await executeSetterPostAction({
        postAction: cfg.post_action,
        workspaceId,
        conversationId,
        contactId,
        existingTags: Array.isArray(contactRow?.tags)
          ? (contactRow.tags as string[])
          : [],
        supabase,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[buffer] runSetterEvaluation error:", msg);
    await supabase
      .from("events")
      .insert({
        type: "setter_evaluation",
        level: "error",
        workspace_id: workspaceId,
        conversation_id: conversationId,
        payload: { error: msg, contact_id: contactId },
      })
      .then(
        () => {},
        () => {},
      );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// executeSetterPostAction (private)
// Runs the configured post_action for a qualified lead. Reuses existing
// executors; create_hl_opportunity is stubbed (logs a pending event) until HL
// pipeline/stage config exists.
// ──────────────────────────────────────────────────────────────────────────────

interface PostActionParams {
  postAction: Record<string, unknown>;
  workspaceId: string;
  conversationId: string;
  contactId: string;
  existingTags: string[];
  supabase: ReturnType<typeof svc>;
}

async function executeSetterPostAction(p: PostActionParams): Promise<void> {
  const type = typeof p.postAction.type === "string" ? p.postAction.type : null;
  if (!type) return;

  try {
    switch (type) {
      case "handoff": {
        // handoff_pending sets ai_enabled=false; only valid from ai_active.
        try {
          await applyTransition(p.conversationId, "handoff_pending", {
            trigger: "agent",
          });
        } catch (e) {
          console.warn(
            "[setter] handoff skipped:",
            e instanceof Error ? e.message : e,
          );
        }
        break;
      }

      case "add_tag": {
        const tag =
          typeof p.postAction.tag === "string" ? p.postAction.tag.trim() : "";
        if (!tag) break;
        const merged = Array.from(new Set([...p.existingTags, tag]));
        await p.supabase
          .from("contacts")
          .update({ tags: merged })
          .eq("id", p.contactId);
        // Best-effort push to HighLevel (no-op if HL not connected).
        void syncContactToHL(p.workspaceId, p.contactId);
        break;
      }

      case "send_template": {
        const templateName =
          typeof p.postAction.template_name === "string"
            ? p.postAction.template_name
            : "";
        if (!templateName) break;
        await dispatchTemplate({
          workspaceId: p.workspaceId,
          conversationId: p.conversationId,
          templateName,
          templateLanguage: "es",
        });
        break;
      }

      case "create_hl_opportunity": {
        // Creates the opportunity in the workspace's configured HL pipeline/stage.
        // Returns null when HL isn't connected or pipeline/stage is unconfigured.
        const result = await createHLOpportunity(p.workspaceId, p.contactId);
        await p.supabase.from("events").insert({
          type: result ? "setter_post_action" : "setter_post_action_failed",
          level: result ? "info" : "warn",
          workspace_id: p.workspaceId,
          conversation_id: p.conversationId,
          payload: {
            action: "create_hl_opportunity",
            contact_id: p.contactId,
            ...(result
              ? { opportunity_id: result.id }
              : {
                  reason:
                    "no se pudo crear la oportunidad (revisa PIT, pipeline y etapa de HighLevel)",
                }),
          },
        });
        break;
      }
    }
  } catch (err) {
    console.error(
      "[setter] post_action error:",
      err instanceof Error ? err.message : err,
    );
  }
}
