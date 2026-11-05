-- pg_cron guarda cada corrida y nunca borra: con el cron de cada minuto ya son 24 MB
-- de 500 en el plan gratis, y siguen creciendo. Una vez por día borra lo de más de 7 días.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'limpiar-historial-cron',
      '17 4 * * *',
      $job$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$job$
    );
  END IF;
END
$$;
