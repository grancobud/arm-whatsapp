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
// must never unsubscribe anyone.

import { createServiceClient as svc } from "@/lib/supabase/service";
import type { ConversationState } from "./state-machine";

export type ConsentIntent = "opt_out" | "opt_in";

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
  if (t.length <= MAX_PHRASE_MESSAGE_CHARS && OPT_OUT_PHRASES.some((p) => t.includes(p))) {
    return "opt_out";
  }
  return null;
}


export type ConsentOutcome = "opted_out" | "opted_in" | "ignored_opted_out";

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
  const supabase = svc();
  const { canTransition } = await import("./state-machine");
  const { applyTransition } = await import("./decision-engine");
  const { dispatchText } = await import("./dispatch");
  // A failed confirmation must never stop the opt-out itself from being saved
  // (YCloud would retry the webhook, and the retry is dropped as a duplicate).
  const confirm = async (body: string, consent: ConsentIntent) => {
    try {
      await dispatchText({
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        body,
        meta: { consent },
      });
    } catch (err) {
      console.error("[opt-out] confirmation failed:", err instanceof Error ? err.message : "unknown");
    }
  };

  const logEvent = (type: string) =>
    supabase.from("events").insert({
      type,
      level: "info",
      workspace_id: params.workspaceId,
      conversation_id: params.conversationId,
      payload: { source: "keyword" },
    });

  if (intent === "opt_out" && params.contactOptIn) {
    // Confirm first: once opt_in is false, dispatch refuses to send anything.
    await confirm(OPT_OUT_CONFIRMATION, "opt_out");
    await supabase
      .from("contacts")
      .update({ opt_in: false })
      .eq("id", params.contactId)
      .eq("workspace_id", params.workspaceId);
    if (canTransition(params.conversationState, "paused")) {
      await applyTransition(params.conversationId, "paused", { trigger: "opt_out" });
    }
    await logEvent("opt_out");
    return "opted_out";
  }

  if (params.contactOptIn) return null;

  if (intent === "opt_in") {
    await supabase
      .from("contacts")
      .update({ opt_in: true, opt_in_source: "WhatsApp: escribió ALTA" })
      .eq("id", params.contactId)
      .eq("workspace_id", params.workspaceId);
    if (params.conversationState === "paused") {
      await applyTransition(params.conversationId, "ai_active", { trigger: "opt_in" });
    }
    await confirm(OPT_IN_CONFIRMATION, "opt_in");
    await logEvent("opt_in");
    return "opted_in";
  }

  // Opted out and wrote something else (or BAJA again): no AI reply.
  return "ignored_opted_out";
}
