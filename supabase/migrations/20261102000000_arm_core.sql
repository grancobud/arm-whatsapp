-- ============================================================
-- Migration: 20261102000000_arm_core
-- Agente WhatsApp — ARM (Agent Relationship Management)
--
-- Three pieces turn the inbox into an ARM:
--   1. contact_claims   — what we know about a contact, each claim tied to the
--                         inbound message that says so (or flagged as a hunch).
--   2. agent_proposals  — actions the agent wants to take that a person must
--                         approve first (sensitive tools, campaign sends).
--   3. campaigns + campaign_recipients — outbound reactivation with approved
--                         templates, only to contacts with opt_in = true.
--
-- Purely additive: new tables, nullable columns, one trigger. RLS on every new
-- table using the existing auth_workspace_ids() / auth_has_role() helpers.
-- No new SECURITY DEFINER functions.
-- ============================================================

-- ---- contacts: consent evidence + opt-out timestamp ----------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opt_in_source TEXT,
  ADD COLUMN IF NOT EXISTS opt_out_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contacts.opt_in_source IS
  'How consent was obtained (form, in-store, WhatsApp reply...). Ley 25.326 asks to be able to show it.';
COMMENT ON COLUMN public.contacts.opt_out_at IS
  'Set automatically when opt_in flips true -> false. Feeds the opt-out-after-campaign metric.';

CREATE OR REPLACE FUNCTION public.contacts_track_opt_in()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.opt_in IS DISTINCT FROM OLD.opt_in THEN
    IF NEW.opt_in THEN
      NEW.opt_in_at := COALESCE(NEW.opt_in_at, NOW());
      NEW.opt_out_at := NULL;
    ELSE
      NEW.opt_out_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_track_opt_in() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_contacts_track_opt_in ON public.contacts;
CREATE TRIGGER trg_contacts_track_opt_in
  BEFORE UPDATE OF opt_in ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_track_opt_in();

-- ---- contact_claims -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('need','goal','objection','commitment','risk','fact')),
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  -- NULL source_message_id = hunch (no inbound message backs it)
  source_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  quote TEXT CHECK (quote IS NULL OR char_length(quote) <= 500),
  author TEXT NOT NULL DEFAULT 'agent' CHECK (author IN ('agent','human')),
  author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_claims_contact
  ON public.contact_claims(workspace_id, contact_id, created_at DESC);

ALTER TABLE public.contact_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws members read contact_claims"
  ON public.contact_claims FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

CREATE POLICY "ws operators write contact_claims"
  ON public.contact_claims FOR ALL
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  );

-- ---- campaigns ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- { stages?: text[], tags?: text[], inactive_days?: int }  (opt_in = true is always enforced)
  segment JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'es',
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','sending','done','rejected','cancelled')),
  recipient_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace
  ON public.campaigns(workspace_id, created_at DESC);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws members read campaigns"
  ON public.campaigns FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

CREATE POLICY "ws managers write campaigns"
  ON public.campaigns FOR ALL
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  );

-- ---- campaign_recipients --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_recipient UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_pending
  ON public.campaign_recipients(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON public.campaign_recipients(campaign_id);

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

-- Read-only for members; rows are written by the server (service role).
CREATE POLICY "ws members read campaign_recipients"
  ON public.campaign_recipients FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

-- ---- agent_proposals ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tool_call')),
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','executed','failed','rejected')),
  result JSONB,
  decided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_pending
  ON public.agent_proposals(workspace_id, status, created_at DESC);

ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;

-- Read-only for members; decisions go through the server, which checks role.
CREATE POLICY "ws members read agent_proposals"
  ON public.agent_proposals FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

-- ---- tools catalog: remember_fact ----------------------------------------
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('remember_fact', 'Recordar dato del cliente',
   'Saves a need, goal, objection, commitment, risk or fact about the contact, grounded on the message that says it',
   '{"type":"object","properties":{"kind":{"type":"string"},"text":{"type":"string"},"quote":{"type":"string"}},"required":["kind","text"]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- Enable it for every existing workspace (new ones enable it from Settings > Tools).
INSERT INTO public.tool_configs (workspace_id, tool_id, enabled)
SELECT w.id, t.id, TRUE
FROM public.workspaces w
CROSS JOIN public.tools t
WHERE t.key = 'remember_fact'
  AND NOT EXISTS (
    SELECT 1 FROM public.tool_configs tc
    WHERE tc.workspace_id = w.id AND tc.tool_id = t.id
  );

-- ============================================================
-- End of migration: 20261102000000_arm_core
-- ============================================================
