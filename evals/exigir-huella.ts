// Huella para cualquier eval: si cambió el examen, no corre hasta re-aprobarlo.
//   npm run eval:xxx -- --aprobar-huella="motivo" --aprobada-por="nombre" [--solo-aprobar]
// Las opciones de la corrida (modelo, casos) son parte del examen.

import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aprobarHuella,
  calcularHuella,
  cierreDeImports,
  explicarRechazo,
  RAIZ,
  resumenHuella,
  revisarHuella,
} from "./huella.ts";

const PROPIAS = ["aprobar-huella", "aprobada-por", "solo-aprobar"];

export function exigirHuella(urlDelRunner: string): void {
  const runner = fileURLToPath(urlDelRunner);
  const carpeta = dirname(runner);
  const aRaiz = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, "").split("=");
      return [k, v.join("=")];
    }),
  );
  const config = Object.fromEntries(Object.entries(args).filter(([k]) => !PROPIAS.includes(k)));

  const entradas = [aRaiz(runner)];
  for (const datos of ["casos.json", "trampas.json"]) {
    if (existsSync(join(carpeta, datos))) entradas.push(aRaiz(join(carpeta, datos)));
  }

  const huella = calcularHuella(cierreDeImports(entradas), config);
  const aprobacion = join(carpeta, "huella-aprobada.json");

  if ("aprobar-huella" in args) {
    aprobarHuella(huella, config, aprobacion, args["aprobada-por"] || userInfo().username, args["aprobar-huella"]);
    console.log(`Huella ${resumenHuella(huella)} aprobada: ${args["aprobar-huella"]}`);
    if ("solo-aprobar" in args) process.exit(0);
  }

  const revision = revisarHuella(huella, aprobacion);
  if (revision.estado !== "aprobada") {
    console.error(explicarRechazo(revision, "esta eval"));
    process.exit(1);
  }
  console.log(`Huella del examen ${resumenHuella(huella)} (aprobada ${revision.aprobacion.fecha.slice(0, 10)})`);
}
