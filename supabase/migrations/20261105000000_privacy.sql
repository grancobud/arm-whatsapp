-- Datos personales (Ley 25.326): aviso en WhatsApp, borrado completo de un
-- contacto y borrado por antigüedad.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS privacy_notice_sent_at timestamptz;

COMMENT ON COLUMN public.contacts.privacy_notice_sent_at IS
  'Cuándo se le mandó el aviso de privacidad por WhatsApp (una sola vez).';

-- Borra al contacto y lo que quedaría suelto: las claves foráneas de estas
-- tablas son ON DELETE SET NULL o no existen, así que la cascada no las alcanza.
-- Los archivos se borran antes, desde la app (ver contact-erasure.ts).
CREATE OR REPLACE FUNCTION public.erase_contact(p_workspace_id uuid, p_contact_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conversations uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = p_contact_id AND workspace_id = p_workspace_id
  ) THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_conversations
  FROM conversations
  WHERE contact_id = p_contact_id AND workspace_id = p_workspace_id;

  DELETE FROM agent_lessons
  WHERE workspace_id = p_workspace_id
    AND (
      message_id IN (SELECT id FROM messages WHERE conversation_id = ANY (v_conversations))
      OR proposal_id IN (SELECT id FROM agent_proposals WHERE contact_id = p_contact_id)
    );
  DELETE FROM events WHERE workspace_id = p_workspace_id AND conversation_id = ANY (v_conversations);
  DELETE FROM automation_runs WHERE workspace_id = p_workspace_id AND conversation_id = ANY (v_conversations);
  DELETE FROM appointments
  WHERE workspace_id = p_workspace_id
    AND (contact_id = p_contact_id OR conversation_id = ANY (v_conversations));

  -- La cascada se lleva conversaciones, mensajes, lotes, memoria, propuestas,
  -- seguimientos y destinatarios de campañas.
  DELETE FROM contacts WHERE id = p_contact_id AND workspace_id = p_workspace_id;
  RETURN true;
END;
$$;

-- Contactos sin actividad hace más que el plazo del cliente.
-- settings.retention_months: meses; 0 = no borrar; sin valor = 12.
CREATE OR REPLACE FUNCTION public.expired_contacts(p_limit integer)
RETURNS TABLE (workspace_id uuid, contact_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.workspace_id, c.id
  FROM contacts c
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE coalesce((w.settings ->> 'retention_months')::integer, 12) > 0
    AND greatest(
          c.created_at,
          coalesce(
            (SELECT max(conv.last_message_at) FROM conversations conv WHERE conv.contact_id = c.id),
            c.created_at
          )
        ) < now() - make_interval(months => coalesce((w.settings ->> 'retention_months')::integer, 12))
  ORDER BY c.created_at
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.erase_contact(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expired_contacts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_contact(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expired_contacts(integer) TO service_role;

-- Corre una vez por día con la misma autorización que buffer-flush, sin escribir
-- el secreto en este archivo. Donde no existe ese job (entorno local), no hace nada.
DO $$
DECLARE
  v_command text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE jobname = 'buffer-flush'$q$ INTO v_command;
  IF v_command IS NOT NULL THEN
    PERFORM cron.schedule(
      'privacy-retention',
      '30 6 * * *',
      replace(v_command, '/api/cron/buffer-flush', '/api/cron/retention')
    );
  END IF;
END;
$$;
