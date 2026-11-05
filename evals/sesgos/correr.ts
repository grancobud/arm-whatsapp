// Evaluación de sesgos: ver casos.ts. Cada variante es una charla de un mensaje que pasa
// por los mismos pasos que buffer.ts.
//
//   npm run eval:sesgos [-- --reps=2]

import { mkdirSync, writeFileSync } from "node:fs";
import { exigirHuella } from "../exigir-huella.ts";
import { correrCharla } from "../charlas/motor.ts";
import { GRUPOS } from "./casos.ts";

exigirHuella(import.meta.url);

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const REPS = Number(argumentos.reps ?? 2);

const resultados: {
  grupo: string;
  variante: string;
  rep: number;
  texto: string;
  herramientas: string[];
  revision: string;
  error: string | null;
  chequeos: { nombre: string; ok: boolean; detalle?: string }[];
}[] = [];

for (const g of GRUPOS) {
  console.log(`\n── ${g.id}: ${g.objetivo}`);
  for (const v of g.variantes) {
    for (let rep = 1; rep <= REPS; rep++) {
      const r = await correrCharla({ id: v.id, mensajes: [v.mensaje], chequear: () => [] }, rep);
      const t = r.turnos[0];
      const chequeos = g.chequear(t);
      resultados.push({
        grupo: g.id,
        variante: v.id,
        rep,
        texto: t.texto,
        herramientas: t.llamadas.map((l) => l.nombre + (l.forzada ? "*" : "")),
        revision: t.revision,
        error: t.error,
        chequeos,
      });
      for (const c of chequeos.filter((x) => !x.ok)) console.log(`  ❌ ${v.id} #${rep} ${c.nombre}`);
    }
  }
}

const bien = (r: (typeof resultados)[number]) => r.chequeos.every((c) => c.ok);
console.log("\n=== Por grupo y variante (respuestas sin ninguna falla) ===");
for (const g of GRUPOS) {
  console.log(`\n${g.id}`);
  for (const v of g.variantes) {
    const del = resultados.filter((r) => r.grupo === g.id && r.variante === v.id);
    const persona = del.filter((r) => r.herramientas.some((h) => h.startsWith("request_human"))).length;
    const largo = Math.round(del.reduce((n, r) => n + r.texto.length, 0) / Math.max(del.length, 1));
    console.log(`  ${v.id.padEnd(24)} ${del.filter(bien).length}/${del.length}   a persona ${persona}/${del.length}   largo ${largo}`);
  }
}
const errores = resultados.filter((r) => r.error).length;
const sinRevisar = resultados.filter((r) => ["review_failed", "rewrite_failed"].includes(r.revision)).length;
console.log(`\nRespuestas: ${resultados.length} · sin falla ${resultados.filter(bien).length} · con error ${errores} · sin revisar ${sinRevisar}`);
if (errores > 0) console.log("⚠️  Hubo errores: una diferencia entre variantes puede ser falta de cupo, no un sesgo.");

mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./resultados/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url), JSON.stringify(resultados, null, 2));
console.log("\n=== Respuestas ===");
for (const r of resultados) console.log(`${r.grupo.slice(0, 14)}|${r.variante}|${r.rep}|${r.herramientas.join(",")}|${r.texto.replace(/\n/g, " ").slice(0, 200)}`);
