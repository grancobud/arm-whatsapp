// What to do with a turn that failed or was cut in the middle. A batch can run
// again after an error, or when the function dies and claim_next_batch reclaims
// it 5 minutes later, so running it from the top could book the same slot or send
// the same reply twice. Progress is saved in the batch's meta before each step.
//
// Pure module so it can be unit-tested on its own.

export const MAX_TURN_ATTEMPTS = 4;
/** A batch of long messages costs tokens and can't be answered well anyway. */
export const MAX_INBOUND_CHARS = 8_000;
/** How long another batch of the conversation waits for the running one. */
export const BUSY_RETRY_MS = 15_000;

export interface TurnProgress {
  /** How many times this batch started, including runs that died. */
  attempts?: number;
  /** A tool with side effects started: running the turn again would repeat it. */
  side_effects?: boolean;
  /** The send started: if nothing else was saved, the customer may have the reply. */
  send_started?: boolean;
  /** The customer already got the reply. */
  reply_sent?: boolean;
}

export type TurnRecovery = "retry" | "finish" | "hand_to_person" | "give_up";

/** Pure: how to go on from what this batch already did. */
export function turnRecovery(progress: TurnProgress): TurnRecovery {
  if (progress.reply_sent) return "finish";
  // Cortado entre el envío y guardar reply_sent: no se sabe si llegó. Repetirlo puede
  // mandar la respuesta dos veces; una persona lo ve y decide.
  if (progress.side_effects || progress.send_started) return "hand_to_person";
  if ((progress.attempts ?? 0) >= MAX_TURN_ATTEMPTS) return "give_up";
  return "retry";
}

/** Saving a memory twice is harmless: it doesn't block a retry. */
export function blocksRetry(tool: { name: string; sensitivity?: string | null }): boolean {
  return tool.sensitivity !== "read" && tool.name !== "remember_fact";
}

export function capInbound(text: string): string {
  return text.length > MAX_INBOUND_CHARS
    ? `${text.slice(0, MAX_INBOUND_CHARS)}\n[El mensaje seguía, pero era demasiado largo y se cortó acá.]`
    : text;
}

/** Is another batch of the conversation running? A dead one stops counting at 5 minutes. */
export function isRunningElsewhere(updatedAt: string, now: number = Date.now()): boolean {
  return now - new Date(updatedAt).getTime() < 5 * 60_000;
}

export const APPROVED_MESSAGE = "¡Listo! El equipo ya confirmó lo que te había quedado pendiente.";

/**
 * Pure: how a decision in Revisión closes with the customer, who was told a
 * person would confirm. With a person already in the chat, they handle it.
 */
export function approvalFollowUp(
  outcome: "done" | "failed" | "rejected",
  state: string | null | undefined,
): { message?: string; handoff?: boolean } {
  if (state !== "ai_active") return {};
  return outcome === "done" ? { message: APPROVED_MESSAGE } : { handoff: true };
}

/** Renders what's waiting for a person, so the agent doesn't ask for it again. */
export function formatPendingActions(actions: { tool_name: string; args: unknown }[]): string {
  if (actions.length === 0) return "";
  const lines = actions.map((a) => `- ${a.tool_name}: ${JSON.stringify(a.args ?? {}).slice(0, 200)}`);
  return [
    "## Pendiente de aprobación",
    "Estas acciones ya las pediste y esperan que una persona las apruebe. No están hechas y no las vuelvas a pedir: si el cliente pregunta, decile que el equipo las está revisando.",
    ...lines,
  ].join("\n");
}
