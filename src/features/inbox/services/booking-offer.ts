// Sin herramienta de agenda, ofrecer un turno es prometer algo que nadie va a hacer.
//
// El prompt ya lo prohíbe (regla 10) y el modelo gratis igual escribe "¿Te gustaría
// agendar para otro día?". Se corrige sobre el texto final, sin otra llamada al modelo:
// sale la oración que ofrece y queda la salida honesta, pasarlo con una persona.
// Módulo puro: se prueba sin base ni red.

/** Herramientas propias que no agendan. Una MCP o un webhook podrían hacerlo: ahí no se toca. */
const NOT_BOOKING = new Set(["echo", "remember_fact", "request_human", "schedule_followup", "update_contact"]);

export const BOOKING_FALLBACK = "Si querés, te paso con una persona del equipo para coordinar el turno.";

const OFFERS = [
  // "te agendo", "te reservé", "te anoto"
  /\bte (agendo|agende|reservo|reserve|anoto|anote|saco un turno)\b/,
  // "puedo reservarte", "te puedo agendar"
  /\b(puedo|podemos) (reservar|agendar|anotar|sacar)/,
  // "puedo ver la agenda", "podemos chequear la disponibilidad"
  /\b(puedo|podemos) (ver|chequear|mirar|consultar|ayudarte a (ver|sacar|agendar|reservar))\b[^.?!]*\b(turno|disponibilidad|agenda|lugar)\b/,
];

/** Solo como pregunta: "para reservar hay que señar" informa, "¿querés reservar?" ofrece. */
const ASKS = /\b(reservar|agendar|sacar (un )?turno|el turno|un turno|que dia|para que dia|dia y hora|que horario)\b/;

const HANDS_OVER = /\b(te paso|te pase|persona|equipo|alguien)\b/;
const DENIES = /\bno (te )?(puedo|podemos)\b/;

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function offersBooking(sentence: string): boolean {
  const t = plain(sentence);
  if (HANDS_OVER.test(t) || DENIES.test(t)) return false;
  return OFFERS.some((re) => re.test(t)) || (sentence.trim().endsWith("?") && ASKS.test(t));
}

/** Si las herramientas no pueden agendar, cambia la oferta de turno por el pase a una persona. */
export function removeBookingOffer(text: string, toolNames: string[]): { text: string; changed: boolean } {
  if (toolNames.some((name) => !NOT_BOOKING.has(name))) return { text, changed: false };

  const sentences = text.split(/(?<=[.!?\n])\s+/);
  const kept = sentences.filter((sentence) => !offersBooking(sentence));
  if (kept.length === sentences.length) return { text, changed: false };

  // Si lo que queda ya ofrece el pase a una persona, no se repite.
  const handsOver = kept.some((sentence) => HANDS_OVER.test(plain(sentence)));
  return { text: (handsOver ? kept : [...kept, BOOKING_FALLBACK]).join(" ").trim(), changed: true };
}
