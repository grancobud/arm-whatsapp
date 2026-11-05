// ¿Anda lo que tiene que andar sin que nadie lo mire? Las alertas corren dentro del cron,
// así que si el cron se cae no avisan: esto lo mira alguien de afuera (.github/workflows/vigilancia.yml).
// No hay registro de la última corrida del cron: lo que se ve es lo que deja de pasar.
// Sin mensajes en la cola, un cron caído no se nota hasta que entra el siguiente.
// Módulo puro: se prueba sin base ni red.

export const OVERDUE_MINUTES = 5;
export const STUCK_MINUTES = 15;

export interface HealthInput {
  databaseOk: boolean;
  /** Lotes que ya tendrían que haberse procesado. */
  overdueBatches: number;
  /** Lotes tomados por un turno que nunca terminó. */
  stuckBatches: number;
  /** Mensajes prometidos que ya tendrían que haber salido. */
  overdueFollowUps: number;
}

export function evaluateHealth(h: HealthInput): { ok: boolean; problems: string[] } {
  if (!h.databaseOk) return { ok: false, problems: ["sin acceso a la base"] };
  const problems: string[] = [];
  if (h.overdueBatches > 0) problems.push(`${h.overdueBatches} lotes demorados: revisar el cron`);
  if (h.stuckBatches > 0) problems.push(`${h.stuckBatches} turnos colgados`);
  if (h.overdueFollowUps > 0) problems.push(`${h.overdueFollowUps} seguimientos demorados: revisar el cron`);
  return { ok: problems.length === 0, problems };
}
