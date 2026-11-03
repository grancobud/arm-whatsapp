-- ============================================================
-- Migration: 20261103020000_automation_runs
-- Each time an automation rule fires. The unique (rule_id, fire_key) is what
-- makes the engine idempotent: a cron tick claims a firing by inserting its
-- row, so overlapping ticks or retries can never run the same action twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  fire_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'skipped', 'failed')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, fire_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workspace
  ON public.automation_runs(workspace_id, created_at DESC);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Written only by the server (service role); members can see the history.
CREATE POLICY "ws members read automation runs" ON public.automation_runs
  FOR SELECT USING (workspace_id IN (SELECT auth_workspace_ids()));
