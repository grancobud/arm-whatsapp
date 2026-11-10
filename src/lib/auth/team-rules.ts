// Quién puede cambiar a quién en el equipo. Módulo puro: se prueba sin base.
//
// Antes alcanzaba con ser manager: un manager podía darse rol admin o desactivar al admin.

export type TeamRole = "admin" | "manager" | "agent" | "viewer";

const RANK: Record<TeamRole, number> = { viewer: 0, agent: 1, manager: 2, admin: 3 };

export interface TeamChange {
  actorRole: TeamRole;
  /** Rol actual de la persona a cambiar; null si todavía no es del equipo. */
  targetRole: TeamRole | null;
  targetIsActive?: boolean;
  /** Rol que tendría después; sin definir si no cambia. */
  newRole?: TeamRole;
  /** true si el cambio la desactiva. */
  deactivates?: boolean;
  /** Admins activos del negocio antes del cambio. */
  activeAdmins: number;
}

/** Devuelve por qué no se puede, o null si se puede. */
export function teamChangeError(c: TeamChange): string | null {
  const isAdmin = c.actorRole === "admin";
  // Solo un admin toca a alguien de su mismo rango o más.
  if (c.targetRole && !isAdmin && RANK[c.targetRole] >= RANK[c.actorRole]) {
    return "Solo un admin puede cambiar a alguien con tu mismo rol o uno más alto.";
  }
  if (c.newRole && !isAdmin && RANK[c.newRole] >= RANK[c.actorRole]) {
    return "Solo un admin puede dar ese rol.";
  }
  const losesAdmin =
    c.targetRole === "admin" &&
    c.targetIsActive !== false &&
    (c.deactivates === true || (c.newRole !== undefined && c.newRole !== "admin"));
  if (losesAdmin && c.activeAdmins <= 1) return "El negocio no puede quedar sin ningún admin activo.";
  return null;
}

/** Pure: el negocio dueño de un archivo, que es el primer tramo de su ruta. */
export function workspaceOfStoragePath(storagePath: string): string | null {
  if (storagePath.includes("..") || storagePath.startsWith("/")) return null;
  const first = storagePath.split("/")[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first) ? first : null;
}
