-- Email alerts (src/features/alerts): every 5 minutes the cron looks, across
-- all workspaces, for the last alert sent and for new problems. events grows
-- with every turn (tool calls, LLM usage), so both lookups get a small partial
-- index instead of scanning the table.

CREATE INDEX IF NOT EXISTS idx_events_problems
  ON public.events (created_at DESC)
  WHERE level IN ('error', 'warn');

CREATE INDEX IF NOT EXISTS idx_events_alert_sent
  ON public.events (created_at DESC)
  WHERE type = 'alert_sent';
