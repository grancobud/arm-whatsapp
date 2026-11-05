import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aprobarHuella, calcularHuella, cierreDeImports, explicarRechazo, hashTexto, normalizarModelo, revisarHuella,
} from "./huella.ts";

function examen(archivos: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "huella-"));
  for (const [nombre, texto] of Object.entries(archivos)) writeFileSync(join(dir, nombre), texto);
  return dir;
}

const CONFIG = { gen: "mistral-medium-3.5", jueces: ["qwen3.8-max"], temperatura: 0.3 };

test("la misma entrada da la misma huella", () => {
  const dir = examen({ "casos.json": "[1,2]", "juez.ts": "nota" });
  const a = calcularHuella(["casos.json", "juez.ts"], CONFIG, dir);
  const b = calcularHuella(["juez.ts", "casos.json"], { temperatura: 0.3, jueces: ["qwen3.8-max"], gen: "mistral-medium-3.5" }, dir);
  assert.equal(a.total, b.total);
});

test("CRLF y LF dan el mismo hash", () => {
  assert.equal(hashTexto("a\r\nb\r\n"), hashTexto("a\nb\n"));
});

test("cambiar un archivo cambia la huella y se nombra el componente", () => {
  const dir = examen({ "casos.json": "[1,2]", "juez.ts": "nota" });
  const archivo = join(dir, "aprobada.json");
  const antes = calcularHuella(["casos.json", "juez.ts"], CONFIG, dir);
  aprobarHuella(antes, CONFIG, archivo, "Gastón", "línea base");
  writeFileSync(join(dir, "juez.ts"), "nota más blanda");
  const despues = calcularHuella(["casos.json", "juez.ts"], CONFIG, dir);
  const r = revisarHuella(despues, archivo);
  assert.equal(r.estado, "cambio");
  assert.deepEqual(r.estado === "cambio" && r.cambios, ["juez.ts"]);
  assert.match(explicarRechazo(r, "npm run eval:agente"), /juez\.ts/);
});

test("cambiar el juez por parámetro también cambia la huella", () => {
  const dir = examen({ "casos.json": "[1,2]" });
  const archivo = join(dir, "aprobada.json");
  aprobarHuella(calcularHuella(["casos.json"], CONFIG, dir), CONFIG, archivo, "Gastón", "línea base");
  const otroJuez = calcularHuella(["casos.json"], { ...CONFIG, jueces: ["gemma-4-31b-it"] }, dir);
  const r = revisarHuella(otroJuez, archivo);
  assert.deepEqual(r.estado === "cambio" && r.cambios, ["config"]);
});

test("sin aprobación la eval no corre", () => {
  const dir = examen({ "casos.json": "[]" });
  const r = revisarHuella(calcularHuella(["casos.json"], CONFIG, dir), join(dir, "no-existe.json"));
  assert.equal(r.estado, "sin_aprobar");
  assert.match(explicarRechazo(r, "npm run eval:agente"), /aprobar-huella/);
});

test("aprobar exige un motivo", () => {
  const dir = examen({ "casos.json": "[]" });
  const h = calcularHuella(["casos.json"], CONFIG, dir);
  assert.throws(() => aprobarHuella(h, CONFIG, join(dir, "a.json"), "Gastón", "  "));
});

test("con la huella aprobada, la revisión pasa", () => {
  const dir = examen({ "casos.json": "[]" });
  const archivo = join(dir, "aprobada.json");
  const h = calcularHuella(["casos.json"], CONFIG, dir);
  aprobarHuella(h, CONFIG, archivo, "Gastón", "línea base");
  const r = revisarHuella(h, archivo);
  assert.equal(r.estado, "aprobada");
  assert.equal(r.estado === "aprobada" && r.aprobacion.aprobadaPor, "Gastón");
});

test("el mismo juez con distinto nombre de proveedor se agrupa", () => {
  assert.equal(normalizarModelo("qwen/qwen3.8-max:free"), "qwen3.8-max");
  assert.equal(normalizarModelo("MiniMax-M3"), normalizarModelo("minimax-m3"));
  assert.equal(normalizarModelo("google/gemma-4-31b-it"), "gemma-4-31b-it");
});

function proyecto() {
  const dir = examen({});
  mkdirSync(join(dir, "src", "guard"), { recursive: true });
  const escribir = (nombre: string, texto: string) => writeFileSync(join(dir, nombre), texto);
  escribir("runner.ts", ['import { calificar } from "./calificador";', 'import { PROMPTS } from "./prompts.ts";', 'import { z } from "zod";'].join("\n"));
  escribir("calificador.ts", ["import {", "  checkReply,", '} from "@/guard";', 'import type { Tipo } from "./tipos";', "export const calificar = 1;"].join("\n"));
  escribir("src/guard/index.ts", "export const checkReply = () => true;");
  escribir("prompts.ts", "export const PROMPTS = {};");
  escribir("tipos.ts", "export type Tipo = 1;");
  return dir;
}

test("la huella sigue los imports: alias @/, multilínea, sin import type ni paquetes, sin lo excluido", () => {
  const dir = proyecto();
  assert.deepEqual(cierreDeImports(["runner.ts"], dir, ["prompts.ts"]), ["calificador.ts", "runner.ts", "src/guard/index.ts"]);
});

test("aflojar un control importado por el calificador cambia la huella", () => {
  const dir = proyecto();
  const antes = calcularHuella(cierreDeImports(["runner.ts"], dir, ["prompts.ts"]), CONFIG, dir);
  writeFileSync(join(dir, "src", "guard", "index.ts"), "export const checkReply = () => true; // más permisivo");
  const despues = calcularHuella(cierreDeImports(["runner.ts"], dir, ["prompts.ts"]), CONFIG, dir);
  assert.notEqual(antes.total, despues.total);
});
