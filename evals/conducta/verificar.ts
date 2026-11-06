// Lo que corre GitHub en cada PR. No llama a ningún modelo ni usa secretos: compara la huella
// del código con la de la constancia. Si tocaste algo de lo que dependen las respuestas, no
// coincide y hay que volver a correr el examen. Si no, pasa sin gastar cupo.

import { existsSync, readFileSync } from "node:fs";
import { calcularHuella, cierreDeImports } from "../huella.ts";
import { verificarConstancia, type Constancia } from "./puerta.ts";

const archivo = new URL("./constancia.json", import.meta.url);
const constancia = existsSync(archivo) ? (JSON.parse(readFileSync(archivo, "utf8")) as Constancia) : null;
const huella = calcularHuella(cierreDeImports(["evals/conducta/correr.ts"]), {}).total;

const veredicto = verificarConstancia(constancia, huella);
if (veredicto.ok) {
  console.log(veredicto.mensaje);
  if (veredicto.aviso) console.log(`::warning title=Sin examen de conducta::${veredicto.aviso}`);
} else {
  console.error(veredicto.mensaje);
  process.exit(1);
}
