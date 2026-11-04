import { createClient as createSbClient } from "@supabase/supabase-js";
import { listAgents } from "@/features/agents/services/agent-queries";
import type { SetupFacts } from "./setup-status";

/** Reads only whether things exist: credential values never leave this file. */
export async function getSetupFacts(workspaceId: string): Promise<SetupFacts> {
  const svc = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const [ycloud, business, kb, templates, team, agents] = await Promise.all([
    svc
      .from("integrations")
      .select("enabled, credentials, config")
      .eq("workspace_id", workspaceId)
      .eq("provider", "ycloud")
      .maybeSingle(),
    svc.from("business_info").select("structured").eq("workspace_id", workspaceId).maybeSingle(),
    svc
      .from("kb_documents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    svc
      .from("templates")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "approved"),
    svc
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    listAgents(svc, workspaceId),
  ]);

  const credentials = (ycloud.data?.credentials as Record<string, unknown> | null) ?? {};
  const config = (ycloud.data?.config as Record<string, unknown> | null) ?? {};
  const structured = (business.data?.structured as Record<string, unknown> | null) ?? {};
  const activeAgent = agents.find((agent) => agent.isActive);

  return {
    ycloudEnabled: ycloud.data?.enabled === true,
    ycloudApiKey: Boolean(credentials.ycloud_api_key),
    phoneNumber: Boolean(config.phone_number),
    webhookSecret: Boolean(credentials.webhook_signing_secret),
    businessName: Boolean(structured.name),
    kbDocuments: kb.count ?? 0,
    activeAgentPublished: Boolean(activeAgent?.promptBody?.trim()),
    approvedTemplates: templates.count ?? 0,
    teamMembers: team.count ?? 0,
  };
}
