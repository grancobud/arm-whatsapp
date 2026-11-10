// Examen de conducta: el corto, el que frena un cambio. Corre en tu PC, porque el modelo gratis
// está en FreeLLMAPI y GitHub no llega; si aprueba, escribe constancia.json y GitHub solo la
// compara con el código (verificar.ts). No guarda texto de ninguna charla en la constancia.
//
//   npm run eval:conducta -- --aprobar-huella="qué cambió" --aprobada-por="nombre"
//
// Para probar un prompt antes de publicarlo. No toca la constancia, porque el prompt no vive
// en el repo. El archivo tampoco va al repo:
//   EVAL_PROMPT_ARCHIVO=ruta npm run eval:conducta

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { exigirHuella } from "../exigir-huella.ts";
import { calcularHuella, cierreDeImports, hashTexto } from "../huella.ts";
import { correrCharla } from "../charlas/motor.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { reviewEnabled } from "../../src/features/inbox/services/reply-review.ts";
import { casosDelExamen } from "./casos.ts";
import { evaluar, quedoSinRevisar, unirConReintento, type Constancia, type ResultadoCaso } from "./puerta.ts";

// El que responde en producción. Sin respaldo: si cae, el examen no concluye; con respaldo,
// la nota podría salir de otro modelo sin que nadie lo note.
const MODELO = "dots-studio/dots-3-note-preview:free";
const REPS = 2;
// Más que en producción, solo acá: con el modelo gratis el revisor se pasa de los 20 s por llamada,
// y el examen mide la conducta, no si llega a tiempo. Producción no cambia; eso se mide aparte.
const TIEMPO_REVISION_MS = 60_000;
// El revisor razona en voz alta y con 1.500 tokens lo cortan antes del veredicto («sin JSON»).
const TOKENS_REVISION = 5_000;

exigirHuella(import.meta.url);

if (!reviewEnabled()) {
  console.error("REPLY_REVIEW está apagado: el examen no se parecería a producción.");
  process.exit(1);
}

const archivoPrompt = process.env.EVAL_PROMPT_ARCHIVO?.trim();
if (archivoPrompt && !existsSync(archivoPrompt)) {
  console.error(`No existe el prompt ${archivoPrompt}`);
  process.exit(1);
}
const promptBase = archivoPrompt ? readFileSync(archivoPrompt, "utf8") : starterPrompt("general", "Barbería El Faro", "Martín");

// El proveedor cachea pedidos idénticos: otra hora en cada corrida obliga a responder de nuevo.
const hora = 11 + Math.floor(Math.random() * 8);

const inicio = Date.now();
let reintentos = 0;
let reintentosRevision = 0;
const opciones = { modelo: MODELO, promptBase, tiempoRevisionMs: TIEMPO_REVISION_MS, tokensRevision: TOKENS_REVISION };
const mostrarFallas = (chequeos: ResultadoCaso["chequeos"]) => {
  for (const c of chequeos.filter((x) => !x.ok)) console.log(`  ❌ ${c.nombre}${c.detalle ? `: ${String(c.detalle).slice(0, 160)}` : ""}`);
};
const resultados: (ResultadoCaso & { turnos: Awaited<ReturnType<typeof correrCharla>>["turnos"] })[] = [];
for (const caso of casosDelExamen()) {
  for (let rep = 1; rep <= REPS; rep++) {
    console.log(`\n── ${caso.id} #${rep}`);
    let r = await correrCharla(caso, rep, { ...opciones, hora });
    // Un solo reintento y solo si el modelo falló: eso no dice nada de la conducta. Una falla
    // de conducta nunca se reintenta. Otra hora, para no repetir un pedido cacheado.
    if (r.turnos.some((t) => t.error)) {
      console.log(`  ↻ el modelo dio error, reintento una vez`);
      reintentos++;
      r = await correrCharla(caso, rep, { ...opciones, hora: hora + 1 });
    }
    mostrarFallas(r.chequeos);
    // Un reintento si faltó revisar: completa lo no medido, pero sus fallas y las del primer
    // intento cuentan todas (unirConReintento).
    if (quedoSinRevisar(r)) {
      console.log(`  ↻ el revisor no pudo revisar: ${r.turnos.find((t) => t.errorRevision)?.errorRevision ?? "sin motivo"}. Reintento una vez`);
      reintentosRevision++;
      const segundo = await correrCharla(caso, rep, { ...opciones, hora: hora + 2 });
      mostrarFallas(segundo.chequeos);
      r = unirConReintento(r, segundo);
    }
    resultados.push(r);
    // Dos charlas seguidas caídas enteras: seguir solo gastaría el cupo que queda.
    if (resultados.length >= 2 && resultados.slice(-2).every((x) => x.turnos.every((t) => t.error))) {
      console.error("\nDos charlas seguidas fallaron enteras: es la configuración o el cupo. No hay resultado.");
      process.exit(2);
    }
  }
}

const e = evaluar(resultados);
const minutos = ((Date.now() - inicio) / 60000).toFixed(1);
console.log(`\n=== Examen de conducta: ${e.estado.toUpperCase()} (${minutos} min, ${e.turnos} turnos) ===`);
console.log(`Bloqueantes ${e.bloqueantes.ok}/${e.bloqueantes.total} · tolerables ${e.tolerables.ok}/${e.tolerables.total} · reintentos por error del modelo ${reintentos} · por falta de revisión ${reintentosRevision}`);
for (const f of e.fallasBloqueantes) console.log(`  ❌ ${f}`);
for (const s of e.sinMedir) console.log(`  ⚠️  ${s}`);

const promptHash = hashTexto(promptBase);
const huella = calcularHuella(cierreDeImports(["evals/conducta/correr.ts"]), {}).total;
const fecha = new Date().toISOString();
mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`./resultados/${fecha.replace(/[:.]/g, "-")}.json`, import.meta.url),
  JSON.stringify({ evaluacion: e, huella, promptHash, modelo: MODELO, archivoPrompt: archivoPrompt ?? null, resultados }, null, 2),
);

if (e.estado === "aprobado" && !archivoPrompt) {
  const constancia: Constancia = {
    resultado: "aprobado",
    huella,
    promptHash,
    modelo: MODELO,
    fecha,
    corridaPor: userInfo().username,
    bloqueantes: e.bloqueantes,
    tolerables: e.tolerables,
    turnos: e.turnos,
  };
  writeFileSync(new URL("./constancia.json", import.meta.url), JSON.stringify(constancia, null, 2) + "\n");
  console.log("Constancia escrita: subila junto con el cambio.");
} else if (archivoPrompt) {
  console.log(`Prompt ${promptHash.slice(0, 12)}: ${e.estado}. La constancia no se toca.`);
}

process.exit(e.estado === "aprobado" ? 0 : e.estado === "reprobado" ? 1 : 2);
