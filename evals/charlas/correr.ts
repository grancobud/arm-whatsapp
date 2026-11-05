// Examen de conversaciones largas: lo que eval:produccion no ve, porque manda un solo
// mensaje por caso. Cada charla pasa turno por turno por los mismos pasos que buffer.ts,
// con la misma ventana de historial (10 mensajes) y la memoria armada con lo que el
// agente guardó. Si buffer.ts suma un paso, va también acá.
//
// Las herramientas son las reales con la ejecución simulada. Después de un traspaso la
// charla termina, como en producción: la IA deja de responder.
//
//   npm run eval:charlas [-- --reps=1] [-- --caso=id]

import { mkdirSync, writeFileSync } from "node:fs";
import { exigirHuella } from "../exigir-huella.ts";
import { CHARLAS } from "./charlas.ts";
import { correrCharla } from "./motor.ts";

exigirHuella(import.meta.url);

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const REPS = Number(argumentos.reps ?? 1);

const elegidas = CHARLAS.filter((c) => !argumentos.caso || argumentos.caso === c.id);
const resultados: Awaited<ReturnType<typeof correrCharla>>[] = [];
for (const c of elegidas) {
  for (let rep = 1; rep <= REPS; rep++) {
    console.log(`\n── ${c.id} #${rep}: ${c.objetivo}`);
    const r = await correrCharla(c, rep);
    resultados.push(r);
    for (const x of r.chequeos.filter((y) => !y.ok)) console.log(`  ❌ ${x.nombre}${x.detalle ? `: ${String(x.detalle).slice(0, 160)}` : ""}`);
    if (resultados.length === 2 && resultados.every((y) => y.turnos.every((t) => t.error))) {
      console.error("\nLas primeras charlas fallaron enteras: es la configuración o el cupo.");
      process.exit(1);
    }
  }
}

const todos = resultados.flatMap((r) => r.chequeos);
const turnos = resultados.flatMap((r) => r.turnos);
console.log("\n=== Resumen ===");
console.log(`Chequeos: ${todos.filter((c) => c.ok).length}/${todos.length}`);
console.log(`Turnos: ${turnos.length} · con error ${turnos.filter((t) => t.error).length} · sin revisar ${turnos.filter((t) => ["review_failed", "rewrite_failed"].includes(t.revision)).length}`);
for (const r of resultados) {
  const mal = r.chequeos.filter((c) => !c.ok).map((c) => c.nombre).join(", ");
  console.log(`  ${`${r.id} #${r.rep}`.padEnd(32)} ${r.chequeos.filter((c) => c.ok).length}/${r.chequeos.length}${mal ? `  ❌ ${mal}` : ""}`);
}
mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./resultados/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url), JSON.stringify(resultados, null, 2));
