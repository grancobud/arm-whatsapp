// Aviso de privacidad: se manda una sola vez, al primer mensaje de cada contacto.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { buildPrivacyNotice, privacyPageUrl } from "@/features/privacy/privacy-rules";

/** Nunca lanza: un aviso que falla no puede frenar la atención del mensaje. */
export async function sendPrivacyNoticeOnce(params: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
}): Promise<void> {
  const db = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  try {
    // Se reserva con un update condicional: dos mensajes simultáneos no mandan dos avisos.
    const { data: claimed } = await db
      .from("contacts")
      .update({ privacy_notice_sent_at: new Date().toISOString() })
      .eq("id", params.contactId)
      .eq("workspace_id", params.workspaceId)
      .is("privacy_notice_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return;

    try {
      const [{ data: info }, { data: workspace }] = await Promise.all([
        db.from("business_info").select("structured").eq("workspace_id", params.workspaceId).maybeSingle(),
        db.from("workspaces").select("name").eq("id", params.workspaceId).maybeSingle(),
      ]);
      const name =
        (info?.structured as { name?: string } | null)?.name?.trim() || workspace?.name || "este negocio";
      const { dispatchText } = await import("./dispatch");
      await dispatchText({
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        body: buildPrivacyNotice(name, privacyPageUrl(process.env.NEXT_PUBLIC_APP_URL)),
        meta: { privacy_notice: true },
      });
    } catch (err) {
      // No salió: se libera para volver a intentar con el próximo mensaje.
      await db
        .from("contacts")
        .update({ privacy_notice_sent_at: null })
        .eq("id", params.contactId)
        .eq("workspace_id", params.workspaceId);
      throw err;
    }
  } catch (err) {
    console.error("[privacy-notice] failed:", err instanceof Error ? err.message : "unknown");
  }
}
