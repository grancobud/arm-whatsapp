// Reply guard — decides whether a model's text can be sent to a customer.
//
// Found auditing against real traffic (FreeLLMAPI "auto"): some routed models
// think out loud and return that reasoning as the reply ("The user asks...",
// "We need to obey policy..."), often cut by the token limit. Sent as-is, the
// customer would get the model's internal notes on WhatsApp. dots-3-note does it
// in Spanish ("El cliente pregunta... Según las reglas, debo..."), about 1 of 6.
//
// Pure module (no imports) so it can be unit-tested on its own.

export type UnusableReason = "empty" | "truncated" | "leaked_reasoning";

export interface ReplyCheck {
  /** Text to send: reasoning tags stripped. Only meaningful when ok. */
  text: string;
  ok: boolean;
  reason?: UnusableReason;
}

// Reasoning that announces itself: talks ABOUT the user, the system or its
// instructions instead of TO the customer.
const LEAK_AT_START =
  /^\s*(the user\b|user (asks|says|wants|is asking|requested)\b|we (need|should|must|have) to\b|the (system|developer)\b|according to the (system|developer|instructions)\b|i (need|should|must) to (respond|answer|reply)\b|okay,? (so )?the user\b|(el|la) (cliente|clienta|usuario|usuaria)\b)/i;

const LEAK_ANYWHERE =
  /\b(system prompt|developer (message|instruction)s?|the user (asks|says|wants|is asking)|higher[- ]level (system )?instructions|seg[uú]n (las|mis) (reglas|instrucciones),? (debo|tengo|no debo|no puedo|si)|(la|las) reglas? (dice|dicen|indica|indican)|mis instrucciones|(el|la) (cliente|clienta|usuario|usuaria) (pregunta|pide|dice|quiere|est[aá]|escribe|se queja))\b/i;

/** Drops <think>…</think> blocks; an unclosed <think> means everything after it is reasoning. */
export function stripThinking(text: string): string {
  let out = text.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, "");
  const open = out.search(/<think(ing)?>/i);
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
}

export function checkReply(rawText: string, finishReason?: string): ReplyCheck {
  const text = stripThinking(rawText ?? "");
  if (!text) return { text, ok: false, reason: "empty" };
  if (finishReason === "length") return { text, ok: false, reason: "truncated" };
  if (LEAK_AT_START.test(text) || LEAK_ANYWHERE.test(text.slice(0, 400))) {
    return { text, ok: false, reason: "leaked_reasoning" };
  }
  return { text, ok: true };
}
