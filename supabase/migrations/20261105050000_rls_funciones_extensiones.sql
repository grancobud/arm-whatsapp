-- Avisos de la base que quedaban: políticas redundantes, funciones de permisos
-- expuestas por la API y extensiones en public. No cambia quién accede a qué: se
-- comparó la matriz de acceso de cada rol y tabla antes y después.

-- 1. Cada tabla tenía una política FOR ALL además de la de lectura, así que SELECT
-- evaluaba dos. La escritura siempre es más estricta que la lectura: separarla no
-- le quita lectura a nadie.
DROP POLICY "ws operators manage agent_lessons" ON public.agent_lessons;
CREATE POLICY "ws operators manage agent_lessons insert" ON public.agent_lessons FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators manage agent_lessons update" ON public.agent_lessons FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators manage agent_lessons delete" ON public.agent_lessons FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY agents_write ON public.agents;
CREATE POLICY "agents_write insert" ON public.agents FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "agents_write update" ON public.agents FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "agents_write delete" ON public.agents FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY appointments_write ON public.appointments;
CREATE POLICY "appointments_write insert" ON public.appointments FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "appointments_write update" ON public.appointments FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "appointments_write delete" ON public.appointments FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY "ws admins manage automations" ON public.automation_rules;
CREATE POLICY "ws admins manage automations insert" ON public.automation_rules FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "ws admins manage automations update" ON public.automation_rules FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "ws admins manage automations delete" ON public.automation_rules FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY business_info_write ON public.business_info;
CREATE POLICY "business_info_write insert" ON public.business_info FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "business_info_write update" ON public.business_info FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "business_info_write delete" ON public.business_info FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY "ws managers write campaigns" ON public.campaigns;
CREATE POLICY "ws managers write campaigns insert" ON public.campaigns FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "ws managers write campaigns update" ON public.campaigns FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "ws managers write campaigns delete" ON public.campaigns FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY "ws operators write contact_claims" ON public.contact_claims;
CREATE POLICY "ws operators write contact_claims insert" ON public.contact_claims FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators write contact_claims update" ON public.contact_claims FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators write contact_claims delete" ON public.contact_claims FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY "ws operators write contacts" ON public.contacts;
CREATE POLICY "ws operators write contacts insert" ON public.contacts FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators write contacts update" ON public.contacts FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators write contacts delete" ON public.contacts FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY "ws operators manage follow_ups" ON public.follow_ups;
CREATE POLICY "ws operators manage follow_ups insert" ON public.follow_ups FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators manage follow_ups update" ON public.follow_ups FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "ws operators manage follow_ups delete" ON public.follow_ups FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY integrations_write_admins ON public.integrations;
CREATE POLICY "integrations_write_admins insert" ON public.integrations FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));
CREATE POLICY "integrations_write_admins update" ON public.integrations FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));
CREATE POLICY "integrations_write_admins delete" ON public.integrations FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));
DROP POLICY kb_chunks_write ON public.kb_chunks;
CREATE POLICY "kb_chunks_write insert" ON public.kb_chunks FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "kb_chunks_write update" ON public.kb_chunks FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "kb_chunks_write delete" ON public.kb_chunks FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY kb_documents_write ON public.kb_documents;
CREATE POLICY "kb_documents_write insert" ON public.kb_documents FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "kb_documents_write update" ON public.kb_documents FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "kb_documents_write delete" ON public.kb_documents FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY message_batches_write ON public.message_batches;
CREATE POLICY "message_batches_write insert" ON public.message_batches FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "message_batches_write update" ON public.message_batches FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
CREATE POLICY "message_batches_write delete" ON public.message_batches FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role, 'agent'::workspace_role])));
DROP POLICY prompt_versions_write ON public.prompt_versions;
CREATE POLICY "prompt_versions_write insert" ON public.prompt_versions FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "prompt_versions_write update" ON public.prompt_versions FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "prompt_versions_write delete" ON public.prompt_versions FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY prompts_write ON public.prompts;
CREATE POLICY "prompts_write insert" ON public.prompts FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "prompts_write update" ON public.prompts FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "prompts_write delete" ON public.prompts FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY schedules_write ON public.schedules;
CREATE POLICY "schedules_write insert" ON public.schedules FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "schedules_write update" ON public.schedules FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "schedules_write delete" ON public.schedules FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY setter_configs_write ON public.setter_configs;
CREATE POLICY "setter_configs_write insert" ON public.setter_configs FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "setter_configs_write update" ON public.setter_configs FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "setter_configs_write delete" ON public.setter_configs FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY templates_write ON public.templates;
CREATE POLICY "templates_write insert" ON public.templates FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "templates_write update" ON public.templates FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
CREATE POLICY "templates_write delete" ON public.templates FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role, 'manager'::workspace_role])));
DROP POLICY tool_configs_write_admins ON public.tool_configs;
CREATE POLICY "tool_configs_write_admins insert" ON public.tool_configs FOR INSERT WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));
CREATE POLICY "tool_configs_write_admins update" ON public.tool_configs FOR UPDATE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role]))) WITH CHECK (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));
CREATE POLICY "tool_configs_write_admins delete" ON public.tool_configs FOR DELETE USING (((workspace_id IN ( SELECT auth_workspace_ids() AS auth_workspace_ids)) AND auth_has_role(workspace_id, ARRAY['admin'::workspace_role])));

-- super_admin_insert_memberships ya incluye al admin.
DROP POLICY memberships_insert_admins ON public.memberships;

-- 2. Las funciones de permisos quedaban invocables desde /rest/v1/rpc. Las políticas
-- apuntan a la función, no al nombre, así que siguen andando. anon necesita USAGE
-- porque las políticas también se evalúan para ese rol; no tiene EXECUTE.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
ALTER FUNCTION public.auth_workspace_ids() SET SCHEMA private;
ALTER FUNCTION public.auth_has_role(uuid, public.workspace_role[]) SET SCHEMA private;
ALTER FUNCTION public.is_super_admin() SET SCHEMA private;

-- 3. Extensiones fuera de public. pg_net no se puede mover: se reinstala. Sus funciones
-- siguen en el esquema net y los crons las llaman por ese nombre.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER FUNCTION public.match_kb_chunks(uuid, extensions.vector, integer) SET search_path = public, extensions;
DROP EXTENSION pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
