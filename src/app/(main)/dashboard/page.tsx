import { redirect } from "next/navigation";
import { needsClientChoice } from "@/features/workspace/services/agency-gate";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import {
  getWorkspaceMetrics,
  getRecentConversations,
} from "@/features/dashboard/services/metrics";
import { getOutcomes } from "@/features/dashboard/services/outcomes";
import { getSuggestions } from "@/features/arm/services/relationship";
import { DashboardMetrics } from "@/features/dashboard/components/dashboard-metrics";
import { getSetupFacts } from "@/features/help/setup-facts";
import { buildSetupStatus } from "@/features/help/setup-status";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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

  const [metrics, recentConversations, outcomes, suggestions, setupFacts] = await Promise.all([
    getWorkspaceMetrics(membership.workspace_id),
    getRecentConversations(membership.workspace_id, 5),
    getOutcomes(membership.workspace_id),
    getSuggestions(membership.workspace_id),
    getSetupFacts(membership.workspace_id),
  ]);

  return (
    <DashboardMetrics
      metrics={metrics}
      recentConversations={recentConversations}
      outcomes={outcomes}
      suggestions={suggestions}
      setupStatus={buildSetupStatus(setupFacts)}
    />
  );
}
