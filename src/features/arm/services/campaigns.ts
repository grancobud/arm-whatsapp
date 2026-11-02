// ARM — outbound reactivation campaigns.
//
// A campaign targets a segment of contacts that gave consent (opt_in = true is
// always enforced, the column defaults to false) and sends them an approved
// marketing template. It is created as pending_approval; once a manager
// approves it, the buffer-flush cron drains recipients in small batches so no
// single request runs into the Vercel timeout.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { dispatchTemplate } from "@/features/inbox/services/dispatch";
import type {
  CampaignMetrics,
  CampaignRow,
  CampaignSegment,
} from "../types";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const MAX_RECIPIENTS_PER_CAMPAIGN = 500;
const SEND_BATCH_SIZE = 20;

/**
 * Rough Meta price of one marketing template to an Argentine number, in USD.
 * Only for the estimate on the approval screen — check Meta's pricing table.
 */
export const MARKETING_TEMPLATE_USD_ESTIMATE = 0.0618;

interface ContactLite {
  id: string;
  name: string | null;
  phone: string;
}

/** Contacts that match the segment. opt_in = true is not optional. */
export async function resolveSegment(
  workspaceId: string,
  segment: CampaignSegment,
): Promise<ContactLite[]> {
  const supabase = svc();

  let query = supabase
    .from("contacts")
    .select("id, name, phone")
    .eq("workspace_id", workspaceId)
    .eq("opt_in", true)
    .limit(MAX_RECIPIENTS_PER_CAMPAIGN * 4);

  if (segment.stages && segment.stages.length > 0) {
    query = query.in("stage", segment.stages);
  }
  if (segment.tags && segment.tags.length > 0) {
    query = query.overlaps("tags", segment.tags);
  }

  const { data } = await query;
  let contacts = (data ?? []) as ContactLite[];

  const days = segment.inactive_days ?? 0;
  if (days > 0 && contacts.length > 0) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // A conversation with any message (either side) after the cutoff is active.
    // Using last_message_at keeps this one bounded query, and a recent outbound
    // send — e.g. a previous campaign — also keeps the contact out, on purpose.
    // Chunked: a few thousand ids in one `in()` would overflow the URL.
    const active = new Set<string>();
    for (let i = 0; i < contacts.length; i += 150) {
      const { data: recent } = await supabase
        .from("conversations")
        .select("contact_id")
        .eq("workspace_id", workspaceId)
        .in(
          "contact_id",
          contacts.slice(i, i + 150).map((c) => c.id),
        )
        .gte("last_message_at", cutoff.toISOString());
      for (const r of (recent ?? []) as { contact_id: string }[]) {
        active.add(r.contact_id);
      }
    }
    contacts = contacts.filter((c) => !active.has(c.id));
  }

  return contacts.slice(0, MAX_RECIPIENTS_PER_CAMPAIGN);
}

export async function createCampaign(params: {
  workspaceId: string;
  userId: string;
  name: string;
  segment: CampaignSegment;
  templateName: string;
  templateLanguage: string;
  variables: string[];
}): Promise<{ id: string; recipientCount: number }> {
  const supabase = svc();
  const recipients = await resolveSegment(params.workspaceId, params.segment);
  if (recipients.length === 0) {
    throw new Error("El segmento no tiene contactos con consentimiento");
  }

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name,
      segment: params.segment,
      template_name: params.templateName,
      template_language: params.templateLanguage,
      variables: params.variables,
      recipient_count: recipients.length,
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (error || !campaign) {
    throw new Error(`No se pudo crear la campaña: ${error?.message}`);
  }
  const campaignId = (campaign as { id: string }).id;

  const { error: recError } = await supabase.from("campaign_recipients").insert(
    recipients.map((c) => ({
      workspace_id: params.workspaceId,
      campaign_id: campaignId,
      contact_id: c.id,
    })),
  );
  if (recError) {
    await supabase.from("campaigns").delete().eq("id", campaignId);
    throw new Error(`No se pudieron guardar los destinatarios: ${recError.message}`);
  }

  return { id: campaignId, recipientCount: recipients.length };
}

async function ensureConversation(
  workspaceId: string,
  contactId: string,
): Promise<string> {
  const supabase = svc();
  await supabase
    .from("conversations")
    .upsert(
      { workspace_id: workspaceId, contact_id: contactId, channel: "whatsapp" },
      { onConflict: "workspace_id,contact_id,channel", ignoreDuplicates: true },
    );
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .single();
  if (error || !data) {
    throw new Error(`conversation upsert failed: ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * Sends the next small batch of pending recipients of approved campaigns.
 * Called from the buffer-flush cron every minute. Returns how many it handled.
 */
export async function drainCampaignQueue(): Promise<number> {
  const supabase = svc();

  const { data: sending } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "sending")
    .order("decided_at", { ascending: true })
    .limit(5);

  let handled = 0;
  for (const campaign of (sending ?? []) as CampaignRow[]) {
    const { data: batch } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(SEND_BATCH_SIZE - handled);

    const rows = (batch ?? []) as { id: string; contact_id: string }[];
    if (rows.length === 0) {
      await supabase
        .from("campaigns")
        .update({ status: "done" })
        .eq("id", campaign.id)
        .eq("status", "sending");
      continue;
    }

    const components =
      campaign.variables.length > 0
        ? [
            {
              type: "body" as const,
              parameters: campaign.variables.map((v) => ({
                type: "text" as const,
                text: v,
              })),
            },
          ]
        : undefined;

    for (const row of rows) {
      handled++;
      // Consent can be withdrawn between approval and sending.
      const { data: contact } = await supabase
        .from("contacts")
        .select("opt_in")
        .eq("id", row.contact_id)
        .single();
      if (!(contact as { opt_in: boolean } | null)?.opt_in) {
        await supabase
          .from("campaign_recipients")
          .update({ status: "skipped", error: "sin consentimiento" })
          .eq("id", row.id);
        continue;
      }

      try {
        const conversationId = await ensureConversation(
          campaign.workspace_id,
          row.contact_id,
        );
        const result = await dispatchTemplate({
          workspaceId: campaign.workspace_id,
          conversationId,
          templateName: campaign.template_name,
          templateLanguage: campaign.template_language,
          components,
        });
        await supabase
          .from("campaign_recipients")
          .update(
            result.ok
              ? {
                  status: "sent",
                  conversation_id: conversationId,
                  sent_at: new Date().toISOString(),
                }
              : {
                  status: "failed",
                  conversation_id: conversationId,
                  error: (result.error ?? "error").slice(0, 300),
                },
          )
          .eq("id", row.id);
      } catch (err) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            error: (err instanceof Error ? err.message : String(err)).slice(
              0,
              300,
            ),
          })
          .eq("id", row.id);
      }
    }

    if (handled >= SEND_BATCH_SIZE) break;
  }
  return handled;
}

/**
 * Sent / replied / opted-out per campaign. Replied = any inbound after the send.
 * One campaign at a time and chunked conversation lookups, so no query runs
 * into PostgREST's row cap or an oversized `in()` URL.
 */
export async function getCampaignMetrics(
  workspaceId: string,
  campaignIds: string[],
): Promise<CampaignMetrics[]> {
  const supabase = svc();
  const out: CampaignMetrics[] = [];

  for (const campaignId of campaignIds) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("status, sent_at, conversation_id, contact:contacts(opt_out_at)")
      .eq("workspace_id", workspaceId)
      .eq("campaign_id", campaignId)
      .limit(MAX_RECIPIENTS_PER_CAMPAIGN);

    const rows = (data ?? []) as unknown as {
      status: string;
      sent_at: string | null;
      conversation_id: string | null;
      contact: { opt_out_at: string | null } | null;
    }[];
    const sent = rows.filter((r) => r.status === "sent" && r.sent_at);

    // conversation_id -> sent_at, then ask which of them got an inbound later.
    const sentAt = new Map<string, string>();
    for (const r of sent) {
      if (r.conversation_id) sentAt.set(r.conversation_id, r.sent_at as string);
    }
    const replied = new Set<string>();
    const convIds = Array.from(sentAt.keys());
    const earliest = sent
      .map((r) => r.sent_at as string)
      .sort()[0];
    for (let i = 0; i < convIds.length; i += 150) {
      const { data: inbound } = await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .in("conversation_id", convIds.slice(i, i + 150))
        .eq("direction", "in")
        .gt("created_at", earliest);
      for (const m of (inbound ?? []) as {
        conversation_id: string;
        created_at: string;
      }[]) {
        const at = sentAt.get(m.conversation_id);
        if (at && m.created_at > at) replied.add(m.conversation_id);
      }
    }

    out.push({
      campaignId,
      sent: sent.length,
      failed: rows.filter((r) => r.status === "failed").length,
      pending: rows.filter((r) => r.status === "pending").length,
      replied: replied.size,
      optedOut: sent.filter(
        (r) =>
          !!r.contact?.opt_out_at &&
          r.contact.opt_out_at > (r.sent_at as string),
      ).length,
    });
  }
  return out;
}
