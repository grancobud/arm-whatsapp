-- ============================================================
-- Migration: 20261103030000_follow_ups
-- Promises the agent makes ("te escribo el jueves"). The agent schedules them
-- with the schedule_followup tool; the cron sends them when they're due.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  -- What the agent will send when it's due (written by the agent, in its voice).
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'needs_human', 'cancelled', 'failed')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_due
  ON public.follow_ups(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_ups_conversation
  ON public.follow_ups(conversation_id, created_at DESC);

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws members read follow_ups" ON public.follow_ups
  FOR SELECT USING (workspace_id IN (SELECT auth_workspace_ids()));

CREATE POLICY "ws operators manage follow_ups" ON public.follow_ups
  FOR ALL USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  ) WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  );

-- ---- tools catalog: schedule_followup -------------------------------------
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('schedule_followup', 'Cumplir lo prometido',
   'Schedules a message the agent promised to send later (e.g. "te escribo el jueves")',
   '{"type":"object","properties":{"due_at":{"type":"string"},"message":{"type":"string"},"reason":{"type":"string"}},"required":["due_at","message"]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

INSERT INTO public.tool_configs (workspace_id, tool_id, enabled)
SELECT w.id, t.id, TRUE
FROM public.workspaces w
CROSS JOIN public.tools t
WHERE t.key = 'schedule_followup'
  AND NOT EXISTS (
    SELECT 1 FROM public.tool_configs tc
    WHERE tc.workspace_id = w.id AND tc.tool_id = t.id
  );
