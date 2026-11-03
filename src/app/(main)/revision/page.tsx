import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import { ReviewQueue } from "@/features/arm/components/review-queue";
import { MARKETING_TEMPLATE_USD_ESTIMATE } from "@/features/arm/services/campaigns";
import type { CampaignRow, ProposalRow } from "@/features/arm/types";

export const dynamic = "force-dynamic";

export default async function RevisionPage() {
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

  const ws = membership.workspace_id;

  // Reads go through RLS: members see only their workspace's rows.
  const [{ data: pending }, { data: history }, { data: campaigns }] =
    await Promise.all([
      supabase
        .from("agent_proposals")
        .select("*")
        .eq("workspace_id", ws)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("agent_proposals")
        .select("*")
        .eq("workspace_id", ws)
        .neq("status", "pending")
        .order("decided_at", { ascending: false })
        .limit(10),
      supabase
        .from("campaigns")
        .select("*")
        .eq("workspace_id", ws)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false }),
    ]);

  return (
    <ReviewQueue
      proposals={(pending ?? []) as ProposalRow[]}
      history={(history ?? []) as ProposalRow[]}
      campaigns={(campaigns ?? []) as CampaignRow[]}
      canDecide={membership.role === "admin" || membership.role === "manager"}
      usdPerMessage={MARKETING_TEMPLATE_USD_ESTIMATE}
    />
  );
}
