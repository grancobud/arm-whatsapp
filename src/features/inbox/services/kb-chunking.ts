// Knowledge-base chunking. Pure module (no imports) so it can be unit-tested.
//
// The old splitter cut every 500 chars: words and prices got split in half and
// a section's title ended up in a different chunk than its content. This one
// follows the document's structure: a chunk never mixes two sections, keeps the
// section title as context, breaks on paragraphs and then sentences (never in
// the middle of a word), carries one sentence of overlap, and drops chunks that
// are only a title.

export const MAX_CHUNK_CHARS = 800;
// A title-only section has no body and yields no piece; this only drops stray
// fragments like "-" or "...", never a short real section ("Cerrado lunes.").
const MIN_CONTENT_CHARS = 3;

const isHeading = (p: string) => /^#{1,6}\s/.test(p);

function sentences(paragraph: string): string[] {
  // Split after . ! ? when followed by space + uppercase/digit/¿¡ (keeps "$3.000" and "30 ml." intact).
  return paragraph.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/).filter(Boolean);
}

function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits one section (its paragraphs, without the title) into pieces of at most `max` chars. */
function packSection(paragraphs: string[], max: number): string[] {
  const units = paragraphs.flatMap((p) =>
    p.length <= max ? [p] : sentences(p).flatMap((s) => (s.length <= max ? [s] : hardSplit(s, max))),
  );
  const pieces: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const u of units) {
    if (current.length && length + u.length + 1 > max) {
      pieces.push(current.join("\n"));
      // One sentence of overlap keeps continuity across the boundary.
      const last = sentences(current[current.length - 1]).at(-1) ?? "";
      current = last && last.length + u.length + 1 <= max ? [last] : [];
      length = current.join("\n").length;
    }
    current.push(u);
    length += u.length + 1;
  }
  if (current.length) pieces.push(current.join("\n"));
  return pieces;
}

export function chunkDocument(text: string, max = MAX_CHUNK_CHARS): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Group paragraphs into sections; a heading line may also start a paragraph.
  const sections: { title: string; body: string[] }[] = [{ title: "", body: [] }];
  for (const p of paragraphs) {
    const [first, ...rest] = p.split("\n");
    if (isHeading(first)) {
      sections.push({ title: first.trim(), body: rest.length ? [rest.join("\n").trim()] : [] });
    } else {
      sections[sections.length - 1].body.push(p);
    }
  }

  const chunks: string[] = [];
  for (const { title, body } of sections) {
    const room = title ? max - title.length - 1 : max;
    for (const piece of packSection(body, Math.max(room, 200))) {
      if (piece.replace(/\s/g, "").length < MIN_CONTENT_CHARS) continue;
      chunks.push(title ? `${title}\n${piece}` : piece);
    }
  }
  return chunks;
}
