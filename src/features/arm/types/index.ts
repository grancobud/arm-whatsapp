// ARM (Agent Relationship Management) — shared types.

export type ClaimKind =
  | "need"
  | "goal"
  | "objection"
  | "commitment"
  | "risk"
  | "fact";

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  need: "Necesidad",
  goal: "Objetivo",
  objection: "Objeción",
  commitment: "Compromiso",
  risk: "Riesgo",
  fact: "Dato",
};

export interface ClaimRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  kind: ClaimKind;
  text: string;
  /** null = hunch: no inbound message backs it. */
  source_message_id: string | null;
  quote: string | null;
  author: "agent" | "human";
  status: "active" | "retracted";
  created_at: string;
}

export type ProposalStatus = "pending" | "executed" | "failed" | "rejected";

export interface ProposalRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  kind: "tool_call";
  tool_name: string;
  args: Record<string, unknown>;
  status: ProposalStatus;
  result: Record<string, unknown> | null;
  decided_at: string | null;
  created_at: string;
}

export interface CampaignSegment {
  stages?: string[];
  tags?: string[];
  /** Only contacts whose last inbound message is at least this many days old. */
  inactive_days?: number;
}

export type CampaignStatus =
  | "pending_approval"
  | "sending"
  | "done"
  | "rejected"
  | "cancelled";

export interface CampaignRow {
  id: string;
  workspace_id: string;
  name: string;
  segment: CampaignSegment;
  template_name: string;
  template_language: string;
  variables: string[];
  status: CampaignStatus;
  recipient_count: number;
  decided_at: string | null;
  created_at: string;
}

export interface CampaignMetrics {
  campaignId: string;
  sent: number;
  failed: number;
  pending: number;
  replied: number;
  optedOut: number;
}
