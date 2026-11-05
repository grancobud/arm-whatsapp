// Lo que el cliente dijo clarito queda en la ficha, aunque el modelo se olvide.
//
// Medido el 05/11 con el modelo gratis: ante "soy Laura y mi correo es..." guardaba
// un solo dato, y con "mi mail es juan@..." lo saludaba como Juan. Acá solo entra lo
// que el cliente afirma de sí mismo: un correo suelto dentro de una frase puede ser
// de otra persona ("les escribí a info@negocio.com"), así que eso lo decide el modelo.

import { plainText as plain } from "@/lib/plain-text";
import type { Tool, ToolContext } from "@/features/tools/core/tool";
import { toolOutcome, type ToolOutcome } from "./reply-review";

const TOOL = "update_contact";

const EMAIL_SOURCE = String.raw`[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-zA-Z]{2,}`;
const OWN_EMAIL = new RegExp(`\\bmi (?:correo|mail|email|e-mail)\\b[^@\\n]{0,30}?(${EMAIL_SOURCE})`, "i");
// Todo el texto: en un lote, una línea suelta puede ser "el mail de mi hermana".
const ONLY_EMAIL = new RegExp(`^\\s*(${EMAIL_SOURCE})\\s*$`);
const ANY_EMAIL = new RegExp(EMAIL_SOURCE, "g");

const WORD = String.raw`[\p{L}'’-]{2,}`;
const NAMED = new RegExp(`\\b(?:me llamo|mi nombre es)\\s+(${WORD}(?:\\s+${WORD}){0,6})`, "iu");
// "soy" solo cuenta con un correo al lado y en mayúscula: "soy de Córdoba" o "soy celíaco" no son nombres.
const INTRODUCED = new RegExp(`\\bsoy\\s+(\\p{Lu}${WORD}(?:\\s+${WORD}){0,6})`, "u");

const CONNECTORS = new Set(["de", "del", "la", "las", "los"]);
const NOT_A_NAME = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "importante", "igual"]);
const startsUpper = (word: string) => /^\p{Lu}/u.test(word);

/** Se queda con la primera palabra y las que siguen en mayúscula: "juan quiero un turno" es "juan". */
function nameFrom(words: string): string | null {
  const [first, ...rest] = words.split(/\s+/);
  if (NOT_A_NAME.has(first.toLowerCase())) return null;
  const name = [first];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (startsUpper(word)) name.push(word);
    else if (CONNECTORS.has(word.toLowerCase()) && rest.slice(i + 1).some(startsUpper)) name.push(word);
    else break;
  }
  return name.length <= 5 ? name.join(" ") : null;
}

export interface ContactData {
  field: "name" | "email";
  value: string;
  quote: string;
}

/** Nombre y correo que el cliente afirma como propios. Módulo puro. */
export function statedContactData(text: string): ContactData[] {
  const found: ContactData[] = [];
  const email = text.match(OWN_EMAIL)?.[1] ?? text.match(ONLY_EMAIL)?.[1];
  if (email) found.push({ field: "email", value: email, quote: email });

  const named = text.match(NAMED) ?? (email ? text.match(INTRODUCED) : null);
  if (named) {
    const name = nameFrom(named[1]);
    if (name) {
      const start = named[0].length - named[1].length;
      found.push({ field: "name", value: name, quote: named[0].slice(0, start) + name });
    }
  }
  return found;
}

/** Guarda lo que el modelo no guardó. Si el dueño pidió aprobar la herramienta, decide él. */
export async function backContactData(params: {
  customerText: string;
  tools: Tool[] | undefined;
  results: ToolOutcome[];
  ctx: ToolContext;
}): Promise<ToolOutcome[]> {
  const { customerText, tools, results, ctx } = params;
  const tool = tools?.find((t) => t.name === TOOL);
  if (!tool || tool.sensitivity === "sensitive") return [];

  const outcomes: ToolOutcome[] = [];
  for (const data of statedContactData(customerText)) {
    const alreadyDone = results.some(
      (r) => r.name === TOOL && r.status !== "failed" && r.args?.field === data.field,
    );
    if (alreadyDone) continue;
    try {
      outcomes.push(toolOutcome(TOOL, await tool.run(data, ctx), data));
    } catch (err) {
      outcomes.push(toolOutcome(TOOL, { ok: false, error: err instanceof Error ? err.message : String(err) }, data));
    }
  }
  return outcomes;
}

/** Casillas de un negocio, no nombres de personas. */
const NOT_A_PERSON = new Set(["info", "ventas", "turnos", "reservas", "contacto", "hola", "admin", "consultas", "soporte", "administracion"]);

/**
 * Saca del texto un nombre que solo salió del correo: "mi mail es juan@x.com" no dice
 * que se llame Juan. Si el cliente lo dijo en otra parte del mensaje, se queda.
 */
export function dropNameFromEmail(reply: string, customerText: string): string {
  const emails = customerText.match(ANY_EMAIL) ?? [];
  if (emails.length === 0) return reply;
  const said = plain(customerText.replace(ANY_EMAIL, " "));

  const guesses = emails
    .flatMap((email) => email.split("@")[0].split(/[^\p{L}]+/u))
    .filter((word) => word.length >= 3 && !NOT_A_PERSON.has(plain(word)))
    .filter((word) => !new RegExp(`(^|[^\\p{L}])${plain(word)}($|[^\\p{L}])`, "u").test(said))
    // Solo con mayúscula, como se escribe un nombre: "te paso la info" no se toca.
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  let out = reply;
  for (const guess of guesses) {
    // Nunca dentro de un correo: "te escribimos a juan@x.com" queda igual.
    const asWord = String.raw`${guess}(?![\p{L}@.]*@)(?![\p{L}])`;
    const before = String.raw`(?<![\p{L}@.])`;
    out = out
      .replace(new RegExp(`^${before}${asWord},?\\s*`, "u"), "")
      .replace(new RegExp(`,?\\s+${before}${asWord}`, "gu"), "");
  }
  if (out === reply) return reply;
  const trimmed = out.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
