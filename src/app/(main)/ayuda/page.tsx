import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import { HelpManual } from "@/features/help/components/help-manual";
import { getSetupFacts } from "@/features/help/setup-facts";
import { buildSetupStatus } from "@/features/help/setup-status";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveWorkspace(supabase, user.id);
  // Without a workspace there's nothing to check, but the manual still reads fine.
  const status = membership
    ? buildSetupStatus(await getSetupFacts(membership.workspace_id))
    : null;

  return <HelpManual status={status} />;
}
