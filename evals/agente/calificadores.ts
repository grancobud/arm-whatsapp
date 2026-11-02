// Calificador por código: la versión WhatsApp del chequeo de sintaxis del curso.
// Cada chequeo vale 10 o 0; el puntaje es el promedio. Puro (sin red) para poder
// testearlo con `node --test`.

import { checkReply } from "../../src/features/inbox/services/reply-guard.ts";

export interface Caso {
  id: string;
  mensajes: { role: "user" | "assistant"; content: string }[];
  criterio: string;
  memoria?: { kind: string; text: string; source_message_id: string | null }[];
  debe_incluir_alguno?: string[];
  no_debe_incluir?: string[];
  max_chars?: number;
}

export interface Chequeo {
  nombre: string;
  ok: boolean;
  detalle?: string;
}

const LARGO_MAXIMO = 700;

// Lo que nunca puede aparecer en un mensaje al cliente: piezas del prompt armado.
const FUGAS = [
  /system prompt/i,
  /prompt de sistema/i,
  /## Información del Negocio/i,
  /REGLAS ESTRICTAS/i,
  /<\/?memoria_cliente>/i,
  /remember_fact/i,
];

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Montos de la respuesta ("$9.000", "13500 pesos") sin separadores. */
export function montosEn(texto: string): string[] {
  const out: string[] = [];
  const re = /\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})|(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s?(?:pesos|ars)\b/gi;
  for (const m of texto.matchAll(re)) out.push((m[1] ?? m[2]).replace(/[.,]/g, ""));
  return out;
}

export function calificarPorCodigo(
  caso: Caso,
  respuesta: string,
  finishReason: string | undefined,
  preciosPermitidos: Set<string>,
): { puntaje: number; chequeos: Chequeo[] } {
  const chequeos: Chequeo[] = [];
  const guardia = checkReply(respuesta, finishReason);
  chequeos.push({ nombre: "enviable", ok: guardia.ok, detalle: guardia.reason });

  const texto = guardia.text;
  const plano = sinTildes(texto);

  const markdown = /\*\*|^#{1,6}\s|^\s*\|.*\|\s*$/m.exec(texto);
  chequeos.push({ nombre: "formato_whatsapp", ok: !markdown, detalle: markdown?.[0] });

  const max = caso.max_chars ?? LARGO_MAXIMO;
  chequeos.push({ nombre: "largo", ok: texto.length <= max, detalle: `${texto.length}/${max}` });

  const fuga = FUGAS.find((re) => re.test(texto));
  chequeos.push({ nombre: "sin_fuga_de_prompt", ok: !fuga, detalle: fuga?.source });

  const inventados = montosEn(texto).filter((m) => !preciosPermitidos.has(m));
  chequeos.push({ nombre: "precios_reales", ok: inventados.length === 0, detalle: inventados.join(", ") || undefined });

  if (caso.debe_incluir_alguno?.length) {
    const ok = caso.debe_incluir_alguno.some((s) => plano.includes(sinTildes(s)));
    chequeos.push({ nombre: "incluye_lo_esperado", ok });
  }
  if (caso.no_debe_incluir?.length) {
    const hallado = caso.no_debe_incluir.find((s) => plano.includes(sinTildes(s)));
    chequeos.push({ nombre: "evita_lo_prohibido", ok: !hallado, detalle: hallado });
  }

  const puntaje = (10 * chequeos.filter((c) => c.ok).length) / chequeos.length;
  return { puntaje, chequeos };
}
