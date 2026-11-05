import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la clave de servicio: se saltea RLS. Solo para código de servidor, que
 * tiene que filtrar por cliente él mismo. Había 50 copias de esta función.
 */
export function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
