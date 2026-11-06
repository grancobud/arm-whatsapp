-- Dos mensajes simultáneos del mismo cliente buscaban un lote abierto, no lo encontraban y
-- abrían uno cada uno: el cliente recibía dos respuestas. Buscar y crear ahora son un solo
-- paso, de a uno por charla.
--
-- Es un bloqueo y no un índice único porque un lote reintentado vuelve a "buffering" y puede
-- convivir con otro recién abierto: con un índice, ese reintento fallaría.

CREATE OR REPLACE FUNCTION public.upsert_buffering_batch(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_silence_ms integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_batch_id uuid;
BEGIN
  -- Se libera solo al terminar la transacción. Otras charlas no esperan.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('upsert_buffering_batch:' || p_conversation_id::text, 0)
  );

  SELECT id INTO v_batch_id
  FROM public.message_batches
  WHERE workspace_id = p_workspace_id
    AND conversation_id = p_conversation_id
    AND status = 'buffering'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.message_batches
    SET flush_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_silence_ms / 1000.0),
        message_count = message_count + 1,
        updated_at = pg_catalog.now()
    WHERE id = v_batch_id;
    RETURN v_batch_id;
  END IF;

  INSERT INTO public.message_batches
    (workspace_id, conversation_id, status, silence_ms, flush_at, message_count, meta)
  VALUES (
    p_workspace_id,
    p_conversation_id,
    'buffering',
    p_silence_ms,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_silence_ms / 1000.0),
    1,
    '{}'::jsonb
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_buffering_batch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_buffering_batch(uuid, uuid, integer) TO service_role;
