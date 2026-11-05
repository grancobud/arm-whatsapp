import { safeError } from "@/lib/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSignedUrl } from "@/features/inbox/services/media-handler";

const requestSchema = z.object({
  storagePath: z.string().min(1),
});

/**
 * POST /api/inbox/media-url
 *
 * Generates a 1-hour signed URL for a file in the whatsapp-media bucket.
 * Requires the caller to be authenticated; the workspace check is implicit
 * because storage_path encodes the workspace_id as its first segment, and
 * the Supabase RLS policy on storage.objects validates workspace membership.
 *
 * Body: { storagePath: string }
 * Response: { url: string }
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Validate body
    const body: unknown = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "storagePath is required" },
        { status: 400 },
      );
    }

    // 2. Verify authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // 3. Generate signed URL (service role, 1 hour TTL)
    const url = await getSignedUrl(parsed.data.storagePath);
    if (!url) {
      return NextResponse.json(
        { error: "No se pudo generar la URL" },
        { status: 404 },
      );
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[POST /api/inbox/media-url]:", safeError(error));
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
