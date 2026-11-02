import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCitations, splitCitations } from "../../src/features/inbox/services/kb-citations.ts";

test("saca la línea de fuentes y devuelve los ids", () => {
  const r = splitCitations("El aceite sale $7.200.\n\nFUENTES: F2, F1, F2");
  assert.equal(r.text, "El aceite sale $7.200.");
  assert.deepEqual(r.ids, ["F2", "F1"]);
});

test("acepta variantes del modelo y 'ninguna'", () => {
  assert.deepEqual(splitCitations("Hola.\n**Fuentes:** F3").ids, ["F3"]);
  const r = splitCitations("No tenemos ese servicio.\nFUENTES: ninguna");
  assert.equal(r.text, "No tenemos ese servicio.");
  assert.deepEqual(r.ids, []);
});

test("una respuesta que es solo la línea queda vacía (la guardia la rechaza)", () => {
  assert.equal(splitCitations("FUENTES: F1").text, "");
});

test("solo resuelve fragmentos que estaban en el prompt", () => {
  const frags = [{ chunk: "## Productos\nEl aceite Lobo de Mar cuesta $7.200.", document_title: "Catálogo" }];
  assert.deepEqual(resolveCitations(["F1", "F9"], frags), [
    { id: "F1", title: "Catálogo", excerpt: "El aceite Lobo de Mar cuesta $7.200." },
  ]);
});
