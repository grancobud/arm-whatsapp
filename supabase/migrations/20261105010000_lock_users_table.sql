-- Prueba de intrusión: cualquier usuario con sesión podía marcarse súper admin,
-- porque la política deja editar la fila propia sin limitar columnas. Y cualquiera
-- leía el correo de todos los usuarios, de todos los clientes.

-- Solo se puede editar lo que no da permisos. La app escribe el resto con service_role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon, authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.users TO authenticated;

-- Se ve a uno mismo y a quienes comparten un cliente con uno.
DROP POLICY IF EXISTS users_select_authenticated ON public.users;
CREATE POLICY users_select_visible ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR id IN (
      SELECT m.user_id FROM public.memberships m
      WHERE m.workspace_id IN (SELECT public.auth_workspace_ids())
    )
  );
