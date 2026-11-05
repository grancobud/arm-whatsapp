// Borrado de datos personales: primero los archivos y después la base. Si fallan
// los archivos, el contacto sigue ahí y se puede reintentar; al revés, sus
// rutas se perderían y los archivos quedarían para siempre.

import type { SupabaseClient } from "@supabase/supabase-js";

export const MEDIA_BUCKET = "whatsapp-media";
const PAGE = 100;

/** Borra todo lo que hay dentro de una carpeta, subcarpetas incluidas. */
export async function removeStorageFolder(db: SupabaseClient, prefix: string): Promise<void> {
  const storage = db.storage.from(MEDIA_BUCKET);
  const folders = new Set<string>();
  for (;;) {
    const { data, error } = await storage.list(prefix, { limit: PAGE });
    if (error) throw new Error(`No se pudieron listar los archivos: ${error.message}`);
    const entries = data ?? [];
    // Las carpetas no tienen id: no se borran, se recorren.
    entries.filter((e) => !e.id).forEach((e) => folders.add(e.name));
    const files = entries.filter((e) => e.id).map((e) => `${prefix}/${e.name}`);
    if (files.length === 0) break;
    const { error: removeError } = await storage.remove(files);
    if (removeError) throw new Error(`No se pudieron borrar los archivos: ${removeError.message}`);
  }
  for (const folder of folders) await removeStorageFolder(db, `${prefix}/${folder}`);
}

/** Borra al contacto, sus conversaciones y sus archivos. Devuelve false si no existe. */
export async function eraseContact(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<boolean> {
  const { data: conversations, error } = await db
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId);
  if (error) throw new Error(`No se pudieron leer las conversaciones: ${error.message}`);

  for (const conversation of conversations ?? []) {
    await removeStorageFolder(db, `${workspaceId}/${conversation.id}`);
  }

  const { data: erased, error: eraseError } = await db.rpc("erase_contact", {
    p_workspace_id: workspaceId,
    p_contact_id: contactId,
  });
  if (eraseError) throw new Error(`No se pudo borrar el contacto: ${eraseError.message}`);
  return erased === true;
}

/** Borra los contactos vencidos según el plazo de cada cliente. Devuelve cuántos borró. */
export async function eraseExpiredContacts(db: SupabaseClient, limit: number): Promise<number> {
  const { data, error } = await db.rpc("expired_contacts", { p_limit: limit });
  if (error) throw new Error(`No se pudieron buscar los contactos vencidos: ${error.message}`);

  const perWorkspace = new Map<string, number>();
  for (const row of (data ?? []) as { workspace_id: string; contact_id: string }[]) {
    try {
      if (await eraseContact(db, row.workspace_id, row.contact_id)) {
        perWorkspace.set(row.workspace_id, (perWorkspace.get(row.workspace_id) ?? 0) + 1);
      }
    } catch (err) {
      // Uno que falla no frena a los demás: se reintenta en la próxima corrida.
      console.error("[retention] erase failed:", err instanceof Error ? err.message : "unknown");
    }
  }

  for (const [workspaceId, count] of perWorkspace) {
    await db.from("events").insert({
      workspace_id: workspaceId,
      type: "retention_erased",
      level: "info",
      payload: { count },
    });
  }
  return [...perWorkspace.values()].reduce((sum, count) => sum + count, 0);
}
