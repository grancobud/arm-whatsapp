-- Avisos de rendimiento de Supabase: claves foráneas sin índice, índices
-- duplicados y políticas que evaluaban auth.uid() una vez por fila.

CREATE INDEX IF NOT EXISTS idx_agent_lessons_created_by ON public.agent_lessons(created_by);
CREATE INDEX IF NOT EXISTS idx_agent_lessons_message ON public.agent_lessons(message_id);
CREATE INDEX IF NOT EXISTS idx_agent_lessons_proposal ON public.agent_lessons(proposal_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_contact ON public.agent_proposals(contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_conversation ON public.agent_proposals(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_decided_by ON public.agent_proposals(decided_by);
CREATE INDEX IF NOT EXISTS idx_agents_prompt ON public.agents(prompt_id);
CREATE INDEX IF NOT EXISTS idx_appointments_conversation ON public.appointments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_appointments_schedule ON public.appointments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_conversation ON public.automation_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact ON public.campaign_recipients(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_conversation ON public.campaign_recipients(conversation_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_workspace ON public.campaign_recipients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON public.campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_decided_by ON public.campaigns(decided_by);
CREATE INDEX IF NOT EXISTS idx_contact_claims_author ON public.contact_claims(author_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_claims_contact ON public.contact_claims(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_claims_source ON public.contact_claims(source_message_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON public.contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON public.conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON public.conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_contact ON public.follow_ups(contact_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_workspace ON public.follow_ups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_created_by ON public.mcp_servers(created_by);
CREATE INDEX IF NOT EXISTS idx_message_batches_workspace ON public.message_batches(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_template ON public.messages(template_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user ON public.permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_by ON public.prompt_versions(created_by);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_workspace ON public.prompt_versions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prompts_active_version ON public.prompts(active_version_id);
CREATE INDEX IF NOT EXISTS idx_tool_configs_tool ON public.tool_configs(tool_id);

-- Duplicados de otro índice o de una restricción UNIQUE que queda.
DROP INDEX IF EXISTS public.idx_contacts_hl_contact_id;
DROP INDEX IF EXISTS public.idx_integrations_workspace;
DROP INDEX IF EXISTS public.idx_prompts_workspace_scope;
DROP INDEX IF EXISTS public.idx_workspaces_slug;

-- Mismas condiciones, evaluadas una sola vez por consulta.
ALTER POLICY "ws agents update conversations" ON public.conversations
  USING (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND (
      public.auth_has_role(workspace_id, ARRAY['admin'::public.workspace_role, 'manager'::public.workspace_role])
      OR assigned_to = (SELECT auth.uid())
    )
  );
ALTER POLICY tools_select_authenticated ON public.tools
  USING ((SELECT auth.uid()) IS NOT NULL);
ALTER POLICY users_update_own ON public.users
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
ALTER POLICY users_select_visible ON public.users
  USING (
    id = (SELECT auth.uid())
    OR public.is_super_admin()
    OR id IN (
      SELECT m.user_id FROM public.memberships m
      WHERE m.workspace_id IN (SELECT public.auth_workspace_ids())
    )
  );
