// Lo que el código asegura después de generar la respuesta y antes del revisor. Lo usan
// buffer.ts, el chat de prueba y los exámenes: cuando estaba copiado en cada uno, el examen
// de producción dejó de medir los guardias sin que nadie lo notara.

import type { Tool, ToolContext } from "@/features/tools/core/tool";
import { backHandoffPromise, withHandoffNotice } from "./handoff-promise";
import { backContactData } from "./contact-capture";
import type { ToolOutcome } from "./reply-review";

export interface TurnGuards {
  /** El texto, con el aviso de traspaso si hizo falta. */
  text: string;
  forcedHandoff: ToolOutcome | null;
  savedContactData: ToolOutcome[];
}

/** Agrega a `results` lo que corrió, para que el revisor lo vea. */
export async function applyTurnGuards(params: {
  text: string;
  customerText: string;
  tools: Tool[] | undefined;
  results: ToolOutcome[];
  ctx: ToolContext;
}): Promise<TurnGuards> {
  const { customerText, tools, results, ctx } = params;
  let { text } = params;

  const forcedHandoff = await backHandoffPromise({ text, tools, results, ctx, customerText });
  if (forcedHandoff) {
    results.push(forcedHandoff);
    if (forcedHandoff.status === "ok") text = withHandoffNotice(text);
  }
  const savedContactData = await backContactData({ customerText, tools, results, ctx });
  results.push(...savedContactData);

  return { text, forcedHandoff, savedContactData };
}
