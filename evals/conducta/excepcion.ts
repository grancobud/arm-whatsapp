// Para un arreglo urgente cuando no hay cupo para correr el examen. Queda escrito en la
// constancia y GitHub lo avisa en el PR. No se pueden encadenar dos seguidas.
//
//   npm run eval:conducta:excepcion -- "motivo"

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { calcularHuella, cierreDeImports } from "../huella.ts";
import { puedeHaberExcepcion, type Constancia } from "./puerta.ts";

const motivo = process.argv.slice(2).join(" ");
const archivo = new URL("./constancia.json", import.meta.url);
const actual = existsSync(archivo) ? (JSON.parse(readFileSync(archivo, "utf8")) as Constancia) : null;

const rechazo = puedeHaberExcepcion(actual, motivo);
if (rechazo) {
  console.error(rechazo);
  process.exit(1);
}

const constancia: Constancia = {
  resultado: "excepcion",
  huella: calcularHuella(cierreDeImports(["evals/conducta/correr.ts"]), {}).total,
  promptHash: null,
  modelo: null,
  fecha: new Date().toISOString(),
  corridaPor: userInfo().username,
  bloqueantes: null,
  tolerables: null,
  turnos: null,
  motivo: motivo.trim(),
};
writeFileSync(archivo, JSON.stringify(constancia, null, 2) + "\n");
console.log("Excepción escrita. Decilo en el PR y corré el examen apenas haya cupo.");
