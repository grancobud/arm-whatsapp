// Una promesa de traspaso tiene que ser verdad.
//
// Medido el 05/11 con el modelo real: ante una queja sin palabras como "persona"
// o "enojado", el modelo respondía "ya le pasé tu mensaje al equipo" sin llamar a
// request_human (0 de 3). Nadie se enteraba. Depender de que el modelo se acuerde
// no alcanza: si el texto final lo promete, el traspaso se hace acá.

import type { Tool, ToolContext } from "@/features/tools/core/tool";
import { toolOutcome, type ToolOutcome } from "./reply-review";

const HANDOFF_TOOL = "request_human";
const TEAM = "(equipo|dueno|duena|persona|alguien|encargad[oa]|responsable)";

const PROMISES = [
  // "ya le pasé tu mensaje al equipo", "te paso con una persona", "te derivé al dueño"
  new RegExp(`\\b(le|te) (pase|paso|derive|derivo)\\b[^.!?]*\\b${TEAM}\\b`),
  // "le pasé tu mensaje a Tito"
  /\ble (pase|paso) (tu|su|el|la|lo)\b/,
  // "paso tu solicitud a Tito"
  /\b(pase|paso) (tu|su) (mensaje|consulta|solicitud|reclamo|caso|pedido)\b/,
  // "te paso con Tito o algún peluquero": a quien sea, el traspaso es el mismo
  /\bte (paso|pase|derivo|derive) con\b/,
  // "ya le avisé a Tito"
  /\bya le (avise|aviso)\b/,
  // "una persona te va a atender", "Tito te va a contactar"
  /\bte (va|van) a (atender|responder|contactar|escribir|llamar)\b/,
  // "Tito te contacta", "se va a comunicar con vos"
  /\bte contacta(n|ra|ran)?\b/,
  /\bse (va|van) a (comunicar|contactar) con vos\b/,
  /\bse comunica(n)? con vos\b/,
];

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Afirma que una persona se va a ocupar. Una pregunta o un "si querés" es solo una oferta. */
export function promisesHandoff(text: string): boolean {
  return text
    .split(/(?<=[.!?\n])\s*/)
    .filter((sentence) => {
      const t = sentence.trim();
      if (!t || t.endsWith("?")) return false;
      // Antes de sacar tildes: "sí, ya le pasé" afirma, "si querés" no.
      return !/(^|[\s,¿(])si\s/i.test(t);
    })
    .some((sentence) => PROMISES.some((re) => re.test(plain(sentence))));
}

/**
 * Si el borrador promete un traspaso y la herramienta no corrió, la corre. Devuelve
 * su resultado para que el revisor lo vea, o null si no había nada que hacer.
 * Si el dueño pidió aprobar esta herramienta, decide él: el revisor marca la promesa.
 */
export async function backHandoffPromise(params: {
  text: string;
  tools: Tool[] | undefined;
  results: ToolOutcome[];
  ctx: ToolContext;
}): Promise<ToolOutcome | null> {
  const { text, tools, results, ctx } = params;
  const tool = tools?.find((t) => t.name === HANDOFF_TOOL);
  if (!tool || tool.sensitivity === "sensitive") return null;
  if (results.some((r) => r.name === HANDOFF_TOOL && r.status !== "failed")) return null;
  if (!promisesHandoff(text)) return null;
  try {
    const result = await tool.run({ reason: "El agente prometió pasar la charla a una persona." }, ctx);
    return toolOutcome(HANDOFF_TOOL, result);
  } catch (err) {
    return toolOutcome(HANDOFF_TOOL, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
