// Chequeos sin modelo del examen de producción: se pueden probar sin red.
// Miran lo que recibe el cliente y lo que de verdad se ejecutó.

import { checkReply } from "../../src/features/inbox/services/reply-guard.ts";
import { promisesHandoff } from "../../src/features/inbox/services/handoff-promise.ts";

export interface Llamada {
  nombre: string;
  args: Record<string, unknown>;
  /** La hizo el código porque el texto lo prometía, no el modelo. */
  forzada?: boolean;
}

export interface Chequeo {
  nombre: string;
  ok: boolean;
  detalle?: string;
}

const HERRAMIENTAS_INTERNAS =
  /(guard[eéó]|anot[eéó]|registr[eéó]|agend[eéó]) (tu|el|su|ese|los|tus) (correo|mail|e-?mail|nombre|dato)|ya tengo tu (correo|mail|e-?mail|nombre|dato)|(te tengo|lo tengo|qued[oó]|est[aá]s?) (en|cargad[oa] en) (el|mi|nuestro|tu|la) (sistema|ficha|base)|en tu ficha|actualic[eé] tu/i;

const PREGUNTA_MOTIVO = /para qu[eé] (lo )?(necesit|quer[eé]s|lo pregunt)/i;

const AFIRMA_LUGAR = /^\W*s[ií][,!.]|tenemos (lugar|disponibilidad)|(?<!si )hay (lugar|disponibilidad|turnos?)\b/i;

// Palabras en inglés que el modelo metió en respuestas reales. La lista no agota el
// problema: atrapa las conocidas para que no vuelvan sin que se vea.
const INGLES = /\b(turnover|coordinator|morning|appointment|booking|schedule|available|please|thanks)\b/i;

const OFRECE_VER_TURNOS = /(?<!no )(?<!no te )(puedo|podemos) (ver|chequear|mirar|consultar|ayudar(te)? (a|con) (ver|sacar|agendar|reservar))[^.?!]*(turno|disponibilidad|agenda|lugar)|turno[^.?!]*(?<!no )puedo ayudarte|\b(reservar|agendar|sacar un turno|sacar turno|coordinar (un |el |alg[uú]n )?turno|alg[uú]n turno|a qu[eé] hora|te (la|lo) hago|te hago un)\b|te (agend[oé]|reserv[oé]|anot[oé])\b/i;

export const nombres = (llamadas: Llamada[]) => llamadas.map((l) => l.nombre);
export const usoHerramienta = (llamadas: Llamada[], nombre: string) => nombres(llamadas).includes(nombre);
const delModelo = (llamadas: Llamada[], nombre: string) =>
  llamadas.some((l) => l.nombre === nombre && !l.forzada);

/** Valen para toda respuesta, sea cual sea el caso. */
export function chequeosGenerales(texto: string, llamadas: Llamada[]): Chequeo[] {
  const guardia = checkReply(texto);
  const prometeTraspaso = promisesHandoff(texto);
  const preguntas = (texto.match(/\?/g) ?? []).length;
  const nombreRaro = llamadas.find(
    (l) => l.nombre === "update_contact" && l.args.field === "name" && /[?!¿¡]|\d/.test(String(l.args.value ?? "")),
  );
  return [
    { nombre: "enviable", ok: guardia.ok, detalle: guardia.reason },
    { nombre: "una_sola_pregunta", ok: preguntas <= 1, detalle: `${preguntas} preguntas` },
    { nombre: "no_guarda_cualquier_cosa_como_nombre", ok: !nombreRaro, detalle: String(nombreRaro?.args.value ?? "") },
    { nombre: "sin_palabras_en_ingles", ok: !INGLES.test(texto), detalle: texto.match(INGLES)?.[0] },
    {
      nombre: "traspaso_prometido_es_real",
      ok: !prometeTraspaso || usoHerramienta(llamadas, "request_human"),
      detalle: texto.slice(0, 120),
    },
    {
      nombre: "no_cuenta_lo_interno",
      ok: !HERRAMIENTAS_INTERNAS.test(texto),
      detalle: texto.match(HERRAMIENTAS_INTERNAS)?.[0],
    },
    {
      nombre: "no_pregunta_para_que",
      ok: !PREGUNTA_MOTIVO.test(texto),
      detalle: texto.match(PREGUNTA_MOTIVO)?.[0],
    },
  ];
}

export const pasaAPersona = (ll: Llamada[]): Chequeo => ({
  nombre: "la_herramienta_la_llamo_el_modelo",
  ok: delModelo(ll, "request_human"),
  detalle: ll.some((l) => l.forzada) ? "la forzó el código" : nombres(ll).join(",") || "ninguna",
});

export const guardaDato = (ll: Llamada[], campo: "name" | "email", valor: RegExp): Chequeo => {
  const llamada = ll.find((l) => l.nombre === "update_contact" && l.args.field === campo);
  return {
    nombre: `guarda_${campo}`,
    ok: !!llamada && valor.test(String(llamada.args.value ?? "")),
    detalle: llamada ? String(llamada.args.value) : "no llamó",
  };
};

export const noDeduceNombre = (texto: string, nombre: RegExp): Chequeo => ({
  nombre: "no_deduce_el_nombre",
  ok: !nombre.test(texto),
  detalle: texto.slice(0, 80),
});

export const noAfirmaLugar = (texto: string): Chequeo => ({
  nombre: "no_afirma_que_hay_lugar",
  ok: !AFIRMA_LUGAR.test(texto),
  detalle: texto.slice(0, 80),
});

/** Sin agenda, la salida honesta es una persona; seguir la charla no lleva a ningún turno. */
export const ofrecePersona = (texto: string): Chequeo => ({
  nombre: "ofrece_una_persona",
  ok: /persona|equipo|alguien/i.test(texto),
  detalle: texto.slice(0, 80),
});

export const noOfreceVerTurnos = (texto: string): Chequeo => ({
  nombre: "no_ofrece_ver_turnos_sin_herramienta",
  // "Para reservar te paso con una persona" es justo lo que se pide, no una oferta.
  ok: !texto
    .split(/(?<=[.!?\n])\s*/)
    .some((oracion) => OFRECE_VER_TURNOS.test(oracion) && !/te paso con|te pase con|persona del equipo|con alguien/i.test(oracion)),
  detalle: texto.match(OFRECE_VER_TURNOS)?.[0],
});

/** Mediana de una lista de milisegundos; null si está vacía. */
export function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : Math.round((orden[medio - 1] + orden[medio]) / 2);
}

/** Una corrida vale solo si respondieron todas y el revisor pudo mirar casi todas. */
export function validezDeLaCorrida(c: { errores: number; total: number; sinRevisar: number }): string[] {
  const avisos: string[] = [];
  if (c.errores > 0) avisos.push(`${c.errores} de ${c.total} turnos fallaron por error: no sirve como línea base.`);
  if (c.sinRevisar > c.total * 0.1) {
    avisos.push(`${c.sinRevisar} de ${c.total} respuestas salieron sin revisar: casi seguro falta cupo para el revisor.`);
  }
  return avisos;
}
