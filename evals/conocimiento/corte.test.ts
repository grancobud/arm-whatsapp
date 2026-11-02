import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "../../src/features/inbox/services/kb-chunking.ts";

test("un fragmento por sección, con su título, y sin títulos sueltos", () => {
  const doc = "# Manual\n\n## Turnos\nSe dan cada 40 minutos.\n\n## Pagos\nEfectivo o transferencia.";
  assert.deepEqual(chunkDocument(doc), [
    "## Turnos\nSe dan cada 40 minutos.",
    "## Pagos\nEfectivo o transferencia.",
  ]);
});

test("una sección larga se parte sin cortar palabras y repite el título", () => {
  const frase = "La seña de $3.000 se pide si cancelás tarde. ";
  const doc = `## Políticas\n${frase.repeat(40)}`;
  const chunks = chunkDocument(doc, 300);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 300, `largo ${c.length}`);
    assert.ok(c.startsWith("## Políticas\n"));
    assert.ok(!/\$3\.$|\$3$/.test(c), "no corta el precio");
    assert.ok(c.trim().endsWith("."), "termina en una oración completa");
  }
});

test("texto sin títulos: agrupa párrafos y descarta los vacíos", () => {
  const chunks = chunkDocument("Primer párrafo con contenido real.\n\n   \n\nSegundo párrafo, también con contenido.");
  assert.deepEqual(chunks, ["Primer párrafo con contenido real.\nSegundo párrafo, también con contenido."]);
});

test("una palabra gigante sin espacios igual se corta al máximo", () => {
  const chunks = chunkDocument("x".repeat(1000), 300);
  assert.ok(chunks.every((c) => c.length <= 300));
  assert.equal(chunks.join("").length, 1000);
});
