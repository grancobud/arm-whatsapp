import { redirect } from "next/navigation";
import { needsClientChoice } from "@/features/workspace/services/agency-gate";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import { extractTemplateVariables } from "@/features/inbox/services/templates";
import { getCampaignMetrics } from "@/features/arm/services/campaigns";
import {
  CampaignsView,
  type TemplateOption,
} from "@/features/arm/components/campaigns-view";
import type { CampaignRow } from "@/features/arm/types";

export const dynamic = "force-dynamic";

export default async function CampanasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (await needsClientChoice(supabase, user.id)) redirect("/workspaces");

  const membership = await getActiveWorkspace(supabase, user.id);

  if (!membership) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-sm">
          No tenés un cliente activo.
        </p>
      </div>
    );
  }

  const ws = membership.workspace_id;

  const [{ data: templateRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("templates")
      .select("id, name, language, body_template")
      .eq("workspace_id", ws)
      .eq("status", "approved")
      .order("name"),
    supabase
      .from("campaigns")
      .select("*")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const templates: TemplateOption[] = (
    (templateRows ?? []) as {
      id: string;
      name: string;
      language: string;
      body_template: string | null;
    }[]
  ).map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    body: t.body_template ?? "",
    variableCount: extractTemplateVariables(t.body_template ?? "").length,
  }));

  const campaigns = (campaignRows ?? []) as CampaignRow[];
  // Membership was checked above; metrics are scoped to this workspace.
  const metrics = await getCampaignMetrics(
    ws,
    campaigns.map((c) => c.id),
  );

  return (
    <CampaignsView
      workspaceId={ws}
      canManage={membership.role === "admin" || membership.role === "manager"}
      templates={templates}
      campaigns={campaigns}
      metrics={metrics}
    />
  );
}
