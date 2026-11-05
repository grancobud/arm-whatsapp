-- El agente puede pasar la charla a una persona y completar la ficha del contacto,
-- con historial para deshacer. Y las herramientas básicas llegan a los clientes nuevos.

INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('request_human', 'Pasar a una persona',
   'Hands the conversation to the team when the customer complains, negotiates or asks for a person',
   '{"type":"object","properties":{"reason":{"type":"string"}}}',
   'write'),
  ('update_contact', 'Completar la ficha',
   'Saves the name or email the customer gave, quoting their message',
   '{"type":"object","properties":{"field":{"type":"string"},"value":{"type":"string"},"quote":{"type":"string"}}}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- Herramientas prendidas por defecto, en los clientes que ya existen...
INSERT INTO public.tool_configs (workspace_id, tool_id, enabled)
SELECT w.id, t.id, TRUE
FROM public.workspaces w
CROSS JOIN public.tools t
WHERE t.key IN ('request_human', 'update_contact', 'remember_fact', 'schedule_followup')
  AND NOT EXISTS (
    SELECT 1 FROM public.tool_configs tc
    WHERE tc.workspace_id = w.id AND tc.tool_id = t.id
  );

-- ...y en los nuevos: hasta ahora nacían sin memoria ni seguimientos.
CREATE OR REPLACE FUNCTION public.workspaces_seed_default_tools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tool_configs (workspace_id, tool_id, enabled)
  SELECT NEW.id, t.id, TRUE
  FROM public.tools t
  WHERE t.key IN ('request_human', 'update_contact', 'remember_fact', 'schedule_followup')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.workspaces_seed_default_tools() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_seed_default_tools ON public.workspaces;
CREATE TRIGGER trg_workspaces_seed_default_tools
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_seed_default_tools();

-- Historial de lo que el agente cambió en la ficha.
CREATE TABLE IF NOT EXISTS public.contact_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  field TEXT NOT NULL CHECK (field IN ('name', 'email')),
  old_value TEXT,
  new_value TEXT NOT NULL,
  quote TEXT,
  source_message_id UUID,
  proposal_id UUID,
  reverted_at TIMESTAMPTZ,
  reverted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_changes_contact
  ON public.contact_changes(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_changes_workspace
  ON public.contact_changes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contact_changes_conversation
  ON public.contact_changes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_contact_changes_reverted_by
  ON public.contact_changes(reverted_by);

ALTER TABLE public.contact_changes ENABLE ROW LEVEL SECURITY;
-- Solo lectura para los miembros: escribe el servidor, con su control de rol.
CREATE POLICY contact_changes_select_members ON public.contact_changes
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

-- Una propuesta aprobada queda "ejecutando" hasta que la herramienta termina. Si
-- la función se corta en el medio, el cron la marca fallida en vez de dejarla
-- como hecha.
ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;
ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('pending', 'executing', 'executed', 'failed', 'rejected'));
