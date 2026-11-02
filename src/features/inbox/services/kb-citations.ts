// Knowledge-base citations that work with any model.
//
// Each retrieved fragment gets an id (F1, F2…) and the agent ends its reply
// with a line "FUENTES: F1, F3" naming the fragments it used. That line is
// removed before the reply reaches the customer and kept for the team, so
// every answer drawn from the KB leaves a trail back to the exact fragment —
// the same idea as the ARM memory "with sources", applied to documents.
// Pure module (no imports) so it can be unit-tested.

export const fragmentId = (index: number) => `F${index + 1}`;

export const CITATION_INSTRUCTION =
  'Si usaste algún fragmento para responder, terminá tu respuesta con una línea aparte "FUENTES: F1" (los id de los fragmentos que usaste, separados por coma). Si no usaste ninguno, terminá con "FUENTES: ninguna". El cliente no ve esa línea: es para el equipo.';

const CITATION_LINE = /^[ \t*_]*FUENTES?[ \t*_]*:[ \t]*(.*)$/gim;

/**
 * Removes every "FUENTES: …" line from the reply and returns the fragment ids
 * it named (deduplicated, in order). Unknown words ("ninguna") are ignored.
 */
export function splitCitations(text: string): { text: string; ids: string[] } {
  const ids: string[] = [];
  const clean = text.replace(CITATION_LINE, (_line, list: string) => {
    for (const m of list.matchAll(/\bF(\d{1,2})\b/gi)) {
      const id = `F${Number(m[1])}`;
      if (!ids.includes(id)) ids.push(id);
    }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), ids };
}

export interface KbSource {
  id: string;
  title: string;
  /** Start of the cited fragment, so the team can check it at a glance. */
  excerpt: string;
}

/** Maps cited ids to the fragments that were in the prompt; ids not shown are dropped. */
export function resolveCitations(
  ids: string[],
  fragments: { chunk: string; document_title: string }[],
): KbSource[] {
  return ids.flatMap((id) => {
    const f = fragments[Number(id.slice(1)) - 1];
    if (!f) return [];
    const body = f.chunk.replace(/^#{1,6}\s.*\n?/, "").replace(/\s+/g, " ").trim();
    return [{ id, title: f.document_title, excerpt: body.slice(0, 160) }];
  });
}
