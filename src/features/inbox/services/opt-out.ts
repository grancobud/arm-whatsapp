// Opt-out by keyword: a contact who writes "BAJA" (or "STOP", "no me escriban
// más"...) stops getting messages, and "ALTA" brings them back. Meta asks for a
// way out, and the number's quality rating drops when people block it instead.
//
// Runs in the webhook before the AI sees the message:
//   - BAJA: we confirm once (the last message they get), mark opt_in = false
//     and pause the conversation so the AI stops answering.
//   - ALTA from someone opted out: opt_in = true again, confirm, AI back on.
//   - Anything else from someone opted out: no AI reply (it couldn't be sent
//     anyway). It stays in the inbox for a person to decide.
//
// Matching is deliberately conservative: a keyword counts only as the whole
// message, or as an unambiguous phrase in a short one. "¿Hay baja de precio?"
// must never unsubscribe anyone. Lo que esta lista no reconoce llega al agente,
// que registra la baja con su herramienta (register-opt-out.ts).

import { createServiceClient as svc } from "@/lib/supabase/service";
import { plainText } from "@/lib/plain-text";
import { affirmedSentences } from "./handoff-promise";
import type { ToolOutcome } from "./reply-review";
import type { ConversationState } from "./state-machine";

export type ConsentIntent = "opt_out" | "opt_in";

export const OPT_OUT_TOOL = "register_opt_out";

const OPT_OUT_EXACT = new Set([
  "baja",
  "stop",
  "unsubscribe",
  "desuscribir",
  "desuscribirme",
  "darme de baja",
  "dame de baja",
  "denme de baja",
  "quiero darme de baja",
  "cancelar suscripcion",
  "no me escriban mas",
  "no me escriban",
  "no quiero mas mensajes",
  "no quiero recibir mas mensajes",
  "no me manden mas mensajes",
]);

const OPT_OUT_PHRASES = [
  "darme de baja",
  "dame de baja",
  "denme de baja",
  "no me escriban mas",
  "dejen de escribirme",
  "dejen de mandarme",
  "no me manden mas",
  "no quiero recibir mas",
];

// Solo cuentan al final del mensaje: "sacame de la lista de espera" o "no me hables
// más de ese corte" no son una baja. Esas las decide el agente.
const OPT_OUT_ENDINGS = [
  "no quiero que me escriban mas",
  "no quiero que me hablen mas",
  "no quiero que me contacten mas",
  "no me escribas mas",
  "no me hablen mas",
  "no me hables mas",
  "no me contacten mas",
  "no me contactes mas",
  "no me molesten mas",
  "no me molestes mas",
  "no me mandes mas",
  "deja de escribirme",
  "deja de mandarme",
  "dejen de molestarme",
  "basta de mensajes",
  "sacame de la lista",
  "sacame de tu lista",
  "saquenme de la lista",
  "saquenme de su lista",
  "borrame de la lista",
  "borrame de tu lista",
  "borrenme de la lista",
  "borrenme de su lista",
];

const TRAILING_COURTESY = /(\s(por favor|porfavor|porfa|muchas gracias|gracias|che))+$/;

const OPT_IN_EXACT = new Set(["alta", "start", "darme de alta", "dame de alta", "suscribirme"]);

/** Phrases only count in short messages (a long one is a real conversation). */
const MAX_PHRASE_MESSAGE_CHARS = 80;

export const OPT_OUT_CONFIRMATION =
  "Listo, te dimos de baja: no te vamos a mandar más mensajes. Si algún día querés volver, escribí ALTA.";
export const OPT_IN_CONFIRMATION =
  "¡Listo, ya estás de vuelta! Contanos en qué te podemos ayudar.";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: does this inbound message ask to stop (or restart) messages? */
export function classifyConsentMessage(text: string | null | undefined): ConsentIntent | null {
  if (!text) return null;
  const t = normalize(text);
  if (!t) return null;
  if (OPT_OUT_EXACT.has(t)) return "opt_out";
  if (OPT_IN_EXACT.has(t)) return "opt_in";
  if (t.length > MAX_PHRASE_MESSAGE_CHARS) return null;
  if (OPT_OUT_PHRASES.some((p) => t.includes(p))) return "opt_out";
  const body = t.replace(TRAILING_COURTESY, "");
  if (OPT_OUT_ENDINGS.some((p) => body === p || body.endsWith(` ${p}`))) return "opt_out";
  return null;
}

const OPT_OUT_PROMISES = [
  // "no te vamos a escribir más", "no te mandamos más mensajes"
  // "No te molesto más" no entra: es una despedida, no una baja.
  /\bno (te|le|les) (vamos a |voy a )?(escribir|escribimos|escribo|mandar|mandamos|mando|contactar|contactamos|contacto) mas( mensajes)?\s*([.,!]|$)/,
  /\b(te|lo|la) (di|dimos|doy|damos) de baja\b/,
  /\bquedaste de baja\b/,
];

/** Pure: el texto le asegura al cliente que no le van a escribir más. */
export function promisesOptOut(text: string): boolean {
  return affirmedSentences(text).some((sentence) => OPT_OUT_PROMISES.some((re) => re.test(plainText(sentence))));
}

/** Pure: en este turno quedó pedida la baja, y lo que sale es la confirmación fija. */
export function optOutRequested(results: Pick<ToolOutcome, "name" | "status">[]): boolean {
  return results.some((r) => r.name === OPT_OUT_TOOL && r.status === "ok");
}

/**
 * Una promesa de baja tiene que ser verdad, aunque el modelo no haya llamado a la herramienta
 * (mismo criterio que backHandoffPromise). Devuelve el resultado para sumar al turno.
 */
export function backOptOutPromise(params: { text: string; results: ToolOutcome[] }): ToolOutcome | null {
  if (optOutRequested(params.results) || !promisesOptOut(params.text)) return null;
  return { name: OPT_OUT_TOOL, status: "ok", summary: "El agente le aseguró al cliente que no le van a escribir más." };
}

export type ConsentOutcome = "opted_out" | "opted_in" | "ignored_opted_out";

type ConsentSource = "keyword" | "agent";

async function confirm(workspaceId: string, conversationId: string, body: string, consent: ConsentIntent) {
  const { dispatchText } = await import("./dispatch");
  // A failed confirmation must never stop the opt-out itself from being saved
  // (YCloud would retry the webhook, and the retry is dropped as a duplicate).
  try {
    const sent = await dispatchText({ workspaceId, conversationId, body, meta: { consent } });
    if (!sent.ok) console.error("[opt-out] confirmation not sent:", sent.error);
  } catch (err) {
    console.error("[opt-out] confirmation failed:", err instanceof Error ? err.message : "unknown");
  }
}

function logEvent(
  type: string,
  level: "info" | "error",
  params: { workspaceId: string; conversationId: string; source: ConsentSource },
) {
  return svc().from("events").insert({
    type,
    level,
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    payload: { source: params.source },
  });
}

/**
 * La baja: confirma, marca opt_in = false y pausa. El mismo camino para la palabra clave y
 * para el agente. Devuelve false si no se pudo guardar: el cliente ya leyó que está de baja
 * y sigue activo, así que tiene que verlo una persona.
 */
export async function applyOptOut(params: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  source: ConsentSource;
}): Promise<boolean> {
  const supabase = svc();
  const { canTransition } = await import("./state-machine");
  const { applyTransition } = await import("./decision-engine");

  // Confirm first: once opt_in is false, dispatch refuses to send anything.
  await confirm(params.workspaceId, params.conversationId, OPT_OUT_CONFIRMATION, "opt_out");
  const { error } = await supabase
    .from("contacts")
    .update({ opt_in: false })
    .eq("id", params.contactId)
    .eq("workspace_id", params.workspaceId);
  if (error) {
    console.error("[opt-out] could not save the opt-out:", error.message);
    await logEvent("opt_out_failed", "error", params);
    return false;
  }

  // El estado de ahora: en este mismo turno pudo pasar a una persona.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("state")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (conversation && canTransition(conversation.state as ConversationState, "paused")) {
    await applyTransition(params.conversationId, "paused", { trigger: "opt_out" });
  }
  await logEvent("opt_out", "info", params);
  return true;
}

/**
 * Applies a BAJA/ALTA message. Returns null when the message is a normal one
 * for a contact who accepts messages: the caller then buffers it for the AI.
 */
export async function handleConsentMessage(params: {
  workspaceId: string;
  contactId: string;
  contactOptIn: boolean;
  conversationId: string;
  conversationState: ConversationState;
  text: string | null;
}): Promise<ConsentOutcome | null> {
  const intent = classifyConsentMessage(params.text);

  if (intent === "opt_out" && params.contactOptIn) {
    await applyOptOut({ ...params, source: "keyword" });
    return "opted_out";
  }

  if (params.contactOptIn) return null;

  if (intent === "opt_in") {
    const { applyTransition } = await import("./decision-engine");
    await svc()
      .from("contacts")
      .update({ opt_in: true, opt_in_source: "WhatsApp: escribió ALTA" })
      .eq("id", params.contactId)
      .eq("workspace_id", params.workspaceId);
    if (params.conversationState === "paused") {
      await applyTransition(params.conversationId, "ai_active", { trigger: "opt_in" });
    }
    await confirm(params.workspaceId, params.conversationId, OPT_IN_CONFIRMATION, "opt_in");
    await logEvent("opt_in", "info", { ...params, source: "keyword" });
    return "opted_in";
  }

  // Opted out and wrote something else (or BAJA again): no AI reply.
  return "ignored_opted_out";
}
