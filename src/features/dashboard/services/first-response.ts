// Tiempo de primera respuesta. Módulo puro: se prueba sin base.

export interface TimedMessage {
  conversation_id: string;
  direction: string;
  created_at: string;
  meta: Record<string, unknown> | null;
}

/** Mediana, en segundos, entre el primer mensaje sin contestar y la respuesta. */
export function computeFirstResponse(messages: TimedMessage[]): number | null {
  const ordered = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const waitingSince = new Map<string, number>();
  const seconds: number[] = [];

  for (const message of ordered) {
    const at = new Date(message.created_at).getTime();
    if (message.direction === "in") {
      if (!waitingSince.has(message.conversation_id)) waitingSince.set(message.conversation_id, at);
      continue;
    }
    // Un aviso automático o una nota interna no le contestan al cliente.
    if (message.meta?.privacy_notice || message.meta?.internal) continue;
    const start = waitingSince.get(message.conversation_id);
    if (start !== undefined) {
      seconds.push((at - start) / 1000);
      waitingSince.delete(message.conversation_id);
    }
  }

  if (seconds.length === 0) return null;
  seconds.sort((a, b) => a - b);
  const middle = Math.floor(seconds.length / 2);
  return seconds.length % 2 ? seconds[middle] : (seconds[middle - 1] + seconds[middle]) / 2;
}

export function formatResponseTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
