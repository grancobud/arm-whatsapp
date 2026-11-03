-- ============================================================
-- Migration: 20261103050000_agent_activation_events
-- Results per agent. Only one agent is active per workspace at a time, so
-- whatever happened (a booking, a qualified lead) belongs to the agent that
-- was active at that moment. This trigger records every activation as an
-- event, whoever makes it (the app, the admin MCP or SQL), and the backfill
-- credits the past to the agent active today.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agents_log_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM TRUE) THEN
    INSERT INTO public.events (workspace_id, type, level, payload)
    VALUES (NEW.workspace_id, 'agent_activated', 'info',
            jsonb_build_object('agent_id', NEW.id, 'agent_type', NEW.type, 'agent_name', NEW.name));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agents_log_activation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_agents_log_activation ON public.agents;
CREATE TRIGGER trg_agents_log_activation
  AFTER INSERT OR UPDATE OF is_active ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agents_log_activation();

-- Backfill: the agent active today gets the history before this migration.
INSERT INTO public.events (workspace_id, type, level, payload, created_at)
SELECT a.workspace_id, 'agent_activated', 'info',
       jsonb_build_object('agent_id', a.id, 'agent_type', a.type, 'agent_name', a.name, 'backfill', true),
       a.created_at
FROM public.agents a
WHERE a.is_active
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.workspace_id = a.workspace_id AND e.type = 'agent_activated'
  );
