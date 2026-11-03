-- ============================================================
-- Migration: 20261103040000_agent_lessons
-- What the team taught the agent: when a person rejects a proposal or
-- corrects a reply, the correction becomes a rule for that workspace and goes
-- into the agent's prompt, so it doesn't repeat the mistake.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('rejected_proposal', 'message_correction', 'manual')),
  -- The rule, in the team's words.
  lesson TEXT NOT NULL CHECK (char_length(lesson) BETWEEN 3 AND 300),
  -- What the agent did (its reply or the proposed action), for context.
  example TEXT CHECK (example IS NULL OR char_length(example) <= 500),
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  proposal_id UUID REFERENCES public.agent_proposals(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_lessons_workspace
  ON public.agent_lessons(workspace_id, created_at DESC) WHERE status = 'active';

ALTER TABLE public.agent_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws members read agent_lessons" ON public.agent_lessons
  FOR SELECT USING (workspace_id IN (SELECT auth_workspace_ids()));

CREATE POLICY "ws operators manage agent_lessons" ON public.agent_lessons
  FOR ALL USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  ) WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  );
