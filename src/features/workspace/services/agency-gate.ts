import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_WORKSPACE_COOKIE } from "./active-workspace";

/**
 * Un súper admin de agencia ve a un cliente solo después de elegirlo. Sin esto,
 * el Panel, Revisión y Campañas abrían a un cliente cualquiera (la Bandeja no).
 */
export async function needsClientChoice(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.is_super_admin) return false;
  return !(await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
}
