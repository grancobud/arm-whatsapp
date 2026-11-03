import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  scoreBM25,
  reciprocalRankFusion,
  rerankHybrid,
} from "../../src/features/inbox/services/kb-rerank.ts";
import {
  chunkDocument,
  extractDocumentTitle,
} from "../../src/features/inbox/services/kb-chunking.ts";

test("tokenize normaliza tildes, minúsculas y elimina palabras vacías", () => {
  const tokens = tokenize("¿Qué es el código PROMO-DIC-05 para el sábado?");
  assert.ok(tokens.includes("codigo"));
  assert.ok(tokens.includes("promo-dic-05"));
  assert.ok(tokens.includes("sabado"));
  assert.ok(!tokens.includes("que"));
  assert.ok(!tokens.includes("el"));
  assert.ok(!tokens.includes("para"));
});

test("scoreBM25 premia términos raros específicos sobre comunes", () => {
  const query = tokenize("código PROMO-DIC-05");
  const docRaro = tokenize("Código PROMO-DIC-05 descuento infantil");
  const docComun = tokenize("Código general de descuentos");

  const docFrequency = new Map([
    ["codigo", 5],
    ["promo-dic-05", 1],
    ["descuento", 3],
  ]);

  const scoreRaro = scoreBM25(query, docRaro, 5, 4, docFrequency);
  const scoreComun = scoreBM25(query, docComun, 5, 4, docFrequency);

  assert.ok(scoreRaro > scoreComun, `scoreRaro ${scoreRaro} debe ser > scoreComun ${scoreComun}`);
});

test("reciprocalRankFusion fusiona dos ordenamientos equilibrando posiciones", () => {
  const rank1 = ["docA", "docB", "docC"];
  const rank2 = ["docB", "docA", "docC"];

  const fused = reciprocalRankFusion([rank1, rank2], (x) => x, 60);

  // docA y docB tienen los mismos puntajes (rank 0 y 1 intercambiados)
  assert.equal(fused[0].item, "docA");
  assert.equal(fused[1].item, "docB");
  assert.equal(fused[2].item, "docC");
  assert.ok(fused[0].score > fused[2].score);
});

test("rerankHybrid rescata un fragmento con código exacto relegado por la semántica", () => {
  const candidatos = [
    {
      chunk: "## Promociones generales\nDescuentos en cortes y barbas de lunes a viernes.",
      similarity: 0.92, // Alta similitud semántica general
    },
    {
      chunk: "## Códigos de promoción\nCódigo ESTUDIANTE-15: 15% con libreta universitaria los jueves.",
      similarity: 0.75, // Menor similitud semántica por ser un fragmento corto
    },
  ];

  const reranked = rerankHybrid("tengo el ESTUDIANTE-15, sirve hoy?", candidatos, 2);

  // El fragmento con ESTUDIANTE-15 debe subir al primer puesto por la coincidencia exacta
  assert.equal(reranked[0].chunk, candidatos[1].chunk);
});

test("extractDocumentTitle detecta el título principal de un markdown", () => {
  const doc = "# Manual de atención — Barbería El Faro\n\n## Turnos\nSe dan cada 40 minutos.";
  assert.equal(extractDocumentTitle(doc), "Manual de atención — Barbería El Faro");
});

test("chunkDocument con contextualPrefix agrega prefijo de documento y sección", () => {
  const doc = "# Manual de Atención\n\n## Turnos\nTurnos cada 40 min.\n\n## Pagos\nEfectivo o tarjeta.";
  const chunks = chunkDocument(doc, { contextualPrefix: true });

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].startsWith("[Manual de Atención · Turnos]\nTurnos cada 40 min."));
  assert.ok(chunks[1].startsWith("[Manual de Atención · Pagos]\nEfectivo o tarjeta."));
});
