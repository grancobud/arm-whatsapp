import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eraseExpiredContacts } from "@/features/privacy/services/contact-erasure";

// Una vez por día (pg_cron, ver 20261105000000_privacy.sql): borra los contactos
// sin actividad hace más que el plazo de cada cliente. Lo que no entra en esta
// corrida queda para la siguiente.
const MAX_PER_RUN = 50;

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const erased = await eraseExpiredContacts(db, MAX_PER_RUN);
    return NextResponse.json({ erased });
  } catch (err) {
    console.error("[retention] failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "No se pudo correr" }, { status: 500 });
  }
}
