/**
 * PATCH /api/contacts/[id]
 * Update a contact's CRM fields. Auth via user session + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { eraseContact } from "@/features/privacy/services/contact-erasure";

const PatchContactSchema = z.object({
  name: z.string().min(1, "El nombre no puede estar vacío").optional(),
  email: z.string().email("Email inválido").optional(),
  stage: z.enum(["new", "engaged", "qualified", "customer", "lost"]).optional(),
  tags: z.array(z.string()).optional(),
  opt_in: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // 2. Resolve route param
  const { id: contactId } = await params;

  if (!contactId) {
    return NextResponse.json(
      { error: "Contact id requerido" },
      { status: 400 },
    );
  }

  // 3. Validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = PatchContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 422 },
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "No se proporcionaron campos a actualizar" },
      { status: 400 },
    );
  }

  // 4. Update (RLS enforces workspace ownership)
  const { data: updated, error: updateError } = await supabase
    .from("contacts")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .select()
    .single();

  if (updateError) {
    console.error(
      "[PATCH /api/contacts/:id] Supabase error:",
      updateError.message,
    );

    if (updateError.code === "PGRST116") {
      return NextResponse.json(
        { error: "Contacto no encontrado" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Error al actualizar el contacto" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, contact: updated });
}

/**
 * DELETE /api/contacts/[id]
 * Erases the contact, its conversations and its files (Ley 25.326, art. 16).
 * Managers and admins only. Cannot be undone.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id: contactId } = await params;

  // RLS: a contact from another workspace simply does not show up.
  const supabase = await createClient();
  const { data: found } = await supabase
    .from("contacts")
    .select("id, workspace_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!found) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const auth = await requireWorkspaceMember(found.workspace_id, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  try {
    const erased = await eraseContact(db, found.workspace_id, contactId);
    if (!erased) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }
    // Who and when, without personal data: this record outlives the contact.
    await db.from("events").insert({
      workspace_id: found.workspace_id,
      type: "contact_erased",
      level: "info",
      payload: { by: auth.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/contacts/:id]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "No se pudo borrar el contacto" }, { status: 500 });
  }
}
