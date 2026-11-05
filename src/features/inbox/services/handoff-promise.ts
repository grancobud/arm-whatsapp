// Una promesa de traspaso tiene que ser verdad.
//
// Medido el 05/11 con el modelo real: ante una queja sin palabras como "persona"
// o "enojado", el modelo respondía "ya le pasé tu mensaje al equipo" sin llamar a
// request_human (0 de 3). Nadie se enteraba. Depender de que el modelo se acuerde
// no alcanza: si el texto final lo promete, el traspaso se hace acá.

import { plainText as plain } from "@/lib/plain-text";
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
  // "voy a pasarte con una persona": el examen de sesgos la encontró sin traspaso
  new RegExp(`\\b(voy|vamos) a pasar(te|lo|la)?\\b[^.!?]*\\b${TEAM}\\b`),
  new RegExp(`\\bte (voy|vamos) a pasar\\b[^.!?]*\\b${TEAM}\\b`),
  // "ya le avisé a Tito"
  /\bya le (avise|aviso)\b/,
  // "una persona te va a atender", "Tito te va a contactar"
  /\bte (va|van) a (atender|responder|contactar|escribir|llamar)\b/,
  // "Tito te contacta", "se va a comunicar con vos"
  /\bte contacta(n|ra|ran)?\b/,
  /\bse (va|van) a (comunicar|contactar) con vos\b/,
  /\bse comunica(n)? con vos\b/,
];

/** Las oraciones que afirman algo: una pregunta o un "si querés" es solo una oferta. */
function affirmedSentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s*/).filter((sentence) => {
    const t = sentence.trim();
    if (!t || t.endsWith("?")) return false;
    // Antes de sacar tildes: "sí, ya le pasé" afirma, "si querés" no.
    return !/(^|[\s,¿(])si\s/i.test(t);
  });
}

/** Afirma que una persona se va a ocupar. Una pregunta o un "si querés" es solo una oferta. */
export function promisesHandoff(text: string): boolean {
  return affirmedSentences(text).some((sentence) => PROMISES.some((re) => re.test(plain(sentence))));
}

// Medido el 05/11: una queja sin palabras como "persona" o "enojado" a veces se contesta
// sin avisarle a nadie. Lista corta a propósito: pasar de más le cuesta un rato a una
// persona; una queja que nadie ve le cuesta el cliente al negocio.
const NEEDS_PERSON = [
  /(?<!no (quiero|necesito|hace falta) )\bhablar con (una persona|alguien|un humano|un asesor|un responsable|el dueno|la duena|el encargado|la encargada)\b/,
  /\b(atencion humana|una persona real)\b/,
  /\b(quiero|voy a) (hacer|dejar|presentar) (un|una) (reclamo|queja)\b/,
  /\btengo (un|una) (reclamo|queja)\b/,
  /\b(es una verguenza|una estafa|me estafaron|pesima atencion|pesimo servicio|malisimo)\b/,
  /\bme (dejaron esperando|hicieron esperar|atendieron mal|trataron mal|arruinaron)\b/,
  /(?<!\bno (me |te |le |nos |lo |la )?)\b(quedo|salio|esta|estaba|lo hicieron|lo dejaron) mal( hecho)?\b/,
  /\bme cobraron (de mas|mal|dos veces)\b/,
  // Una queja también se escribe con buenos modales.
  /\b(mi disconformidad|no fue satisfactorio|no me quedo bien)\b/,
  /\bestoy (muy |re |bastante )?(enojad[oa]|harto|harta|indignad[oa]|furios[oa]|caliente)\b/,
  /\bnadie me (responde|contesta|atiende|llama)\b/,
  /\bno me (solucionaron|resolvieron|respondieron|contestaron|devolvieron)\b/,
];

/** El cliente se queja o pide a una persona con palabras que no dejan dudas. */
export function asksForPerson(customerText: string): boolean {
  const t = plain(customerText);
  return NEEDS_PERSON.some((re) => re.test(t));
}

const FOLLOWUP_TOOL = "schedule_followup";
const FOLLOWUP_PROMISE = /\bte (escribo|escribimos|escribire|escribiremos|aviso|avisamos|avisare|llamo|llamamos|contacto|contactamos)\b/;

/**
 * "Te escribo el viernes" sin seguimiento agendado es un mensaje que nunca sale.
 * El examen del 05/11 lo encontró. Sin la fecha no se puede agendar acá, así que
 * lo toma una persona, que ve el motivo.
 */
export function promisesFollowup(text: string): boolean {
  return affirmedSentences(text).some((sentence) => FOLLOWUP_PROMISE.test(plain(sentence)));
}

export const HANDOFF_NOTICE = "Una persona del equipo te va a atender.";

/** El cliente tiene que saber que lo pasamos, aunque el modelo no lo haya dicho. */
export function withHandoffNotice(text: string): string {
  if (promisesHandoff(text)) return text;
  return [text.trim(), HANDOFF_NOTICE].filter(Boolean).join(" ");
}

/**
 * Si el borrador promete un traspaso o el cliente lo necesita, y la herramienta no
 * corrió, la corre. Devuelve su resultado para que el revisor lo vea, o null si no
 * había nada que hacer.
 * Si el dueño pidió aprobar esta herramienta, decide él: el revisor marca la promesa.
 */
export async function backHandoffPromise(params: {
  text: string;
  tools: Tool[] | undefined;
  results: ToolOutcome[];
  ctx: ToolContext;
  customerText?: string;
}): Promise<ToolOutcome | null> {
  const { text, tools, results, ctx, customerText } = params;
  const tool = tools?.find((t) => t.name === HANDOFF_TOOL);
  if (!tool || tool.sensitivity === "sensitive") return null;
  if (results.some((r) => r.name === HANDOFF_TOOL && r.status !== "failed")) return null;
  const promised = promisesHandoff(text);
  const followupOwed =
    promisesFollowup(text) && !results.some((r) => r.name === FOLLOWUP_TOOL && r.status !== "failed");
  if (!promised && !followupOwed && !(customerText && asksForPerson(customerText))) return null;
  const reason = promised
    ? "El agente prometió pasar la charla a una persona."
    : followupOwed
      ? `El agente le prometió escribirle más adelante y no lo agendó: "${text.slice(0, 200)}"`
      : "El cliente se quejó o pidió hablar con una persona.";
  try {
    const result = await tool.run({ reason }, ctx);
    return toolOutcome(HANDOFF_TOOL, result);
  } catch (err) {
    return toolOutcome(HANDOFF_TOOL, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
