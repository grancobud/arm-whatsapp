// Los últimos retoques del texto, iguales en buffer.ts, en el chat de prueba y en los
// exámenes: lo que el prompt pide y el modelo gratis a veces no cumple.
// Módulo puro: se prueba sin base ni red.

import { removeBookingOffer } from "./booking-offer";
import { dropNameFromEmail } from "./contact-capture";

// "ya lo actualicé", "guardé tu correo", "cargados en el sistema": al cliente no le sirve
// y anuncia cosas que el dueño no eligió contarle (regla 11 del prompt de arranque).
const INTERNAL_TALK =
  /\b(ya )?(lo|la) (guarde|actualice)\b|\b(guarde|actualice) (tu|el|la)\b|\bqued(o|aron) guardad[oa]s?\b|\ben (la|tu) ficha\b|\ben (el|mi|nuestro) sistema\b/;

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function dropInternalTalk(text: string): string {
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  const kept = sentences.filter((sentence) => !INTERNAL_TALK.test(plain(sentence)));
  if (kept.length === sentences.length) return text;
  return kept.join(" ").trim() || "¡Gracias!";
}

export function finishReply(
  text: string,
  toolNames: string[],
  customerText: string,
): { text: string; bookingOfferRemoved: boolean } {
  const cleaned = dropInternalTalk(dropNameFromEmail(text, customerText));
  const offer = removeBookingOffer(cleaned, toolNames, customerText);
  return { text: offer.text, bookingOfferRemoved: offer.changed };
}
