// Phase 4: read the curated, global template library (RLS: published only).
// Used by the "Biblioteca" tab to pre-fill the builder.

import { safeError } from "@/lib/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Confirm the caller belongs to the workspace (the library is global, but we
  // keep the route workspace-scoped for consistent access control).
  const { data: member } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("template_library")
    .select(
      "id, title, description, use_case, category, language, header_type, header_text, body_template, footer_text, buttons, variables, sort_order",
    )
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[GET /api/workspace/[id]/templates/library]:", safeError(error));
    return NextResponse.json(
      { error: "Error al cargar la biblioteca" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}
