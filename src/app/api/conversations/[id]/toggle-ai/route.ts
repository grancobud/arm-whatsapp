import { safeError } from "@/lib/safe-error";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const toggleAiSchema = z.object({
  ai_enabled: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // 1. Parse and validate body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = toggleAiSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { ai_enabled } = parsed.data;

    // 2. Verify authenticated user session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Resolve conversation id from route params
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing conversation id" },
        { status: 400 },
      );
    }

    // 4. Update ai_enabled — RLS ensures user can only touch their workspace rows
    const { data, error: updateError } = await supabase
      .from("conversations")
      .update({
        ai_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, ai_enabled")
      .single();

    if (updateError) {
      if (updateError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      console.error("[toggle-ai] update error:", updateError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ai_enabled: data.ai_enabled });
  } catch (err) {
    console.error("[toggle-ai] unhandled error:", safeError(err));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
