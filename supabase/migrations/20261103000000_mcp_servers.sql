-- ARM as an MCP client: the MCP servers each workspace connects (its calendar,
-- CRM, stock…). The agent gets their tools per turn (src/features/tools/mcp).
--
-- credentials holds the auth header ENCRYPTED with integration-secrets (bound to
-- <workspace_id>:mcp:<slug>), and is never readable by browser sessions: members
-- get column-level SELECT on everything except it. All writes go through
-- server actions (service role) that check the manager role.

CREATE TABLE public.mcp_servers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9]{1,16}$'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  url           text NOT NULL CHECK (url ~ '^https://'),
  credentials   jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  -- { "<tool>": "read" | "sensitive" | "off" }; a missing tool means "sensitive".
  tool_policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX idx_mcp_servers_workspace ON public.mcp_servers(workspace_id) WHERE enabled;

ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws members read mcp_servers"
  ON public.mcp_servers FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

-- Browser sessions: read everything but the credentials column; no writes.
REVOKE ALL ON public.mcp_servers FROM anon, authenticated;
GRANT SELECT (id, workspace_id, slug, name, url, enabled, tool_policies, created_by, created_at, updated_at)
  ON public.mcp_servers TO authenticated;
