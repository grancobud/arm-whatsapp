import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import {
  getWorkspaceMetrics,
  getRecentConversations,
} from "@/features/dashboard/services/metrics";
import { DashboardMetrics } from "@/features/dashboard/components/dashboard-metrics";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

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

  const [metrics, recentConversations] = await Promise.all([
    getWorkspaceMetrics(membership.workspace_id),
    getRecentConversations(membership.workspace_id, 5),
  ]);

  return (
    <DashboardMetrics
      metrics={metrics}
      recentConversations={recentConversations}
    />
  );
}
