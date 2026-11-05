// Huella del evaluador: una nota solo se compara con otra si el examen es el mismo.
//
// Se calcula un hash de todo lo que define el examen (runner, calificadores, casos,
// código de producción que arma el prompt y la configuración: modelo que responde,
// jueces, temperatura). Esa huella queda aprobada por una persona en un JSON
// versionado. Si cualquier componente cambia, la eval se niega a correr hasta que
// alguien la re-apruebe con un motivo: así una nota mejor no puede salir de un
// examen más blando sin que quede escrito. Idea de Arian Z. (comentario en LinkedIn).
//
// Lo que se está evaluando (los prompts) NO entra en la huella: cambiar o agregar
// una versión no exige re-aprobar. Su hash se guarda aparte en cada resultado.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = fileURLToPath(new URL("../", import.meta.url));

export interface Huella {
  total: string;
  componentes: Record<string, string>;
}

export interface Aprobacion extends Huella {
  config: Record<string, unknown>;
  fecha: string;
  aprobadaPor: string;
  motivo: string;
}

// CRLF y LF dan el mismo hash: un checkout en Windows no es un cambio del examen.
export const hashTexto = (texto: string) => createHash("sha256").update(texto.replace(/\r\n?/g, "\n")).digest("hex");

const corto = (h: string) => h.slice(0, 12);

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, ordenar((valor as Record<string, unknown>)[k])]));
  }
  return valor;
}

// Imports con valor (no `import type`), multilínea incluidos, y re-exports.
const IMPORTS = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolverImport(especificador: string, desde: string, raiz: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = resolve(raiz, "src", especificador.slice(2));
  else if (especificador.startsWith(".")) base = resolve(desde, "..", especificador);
  else return null; // paquete de node_modules: no es parte del examen
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return null;
}

/**
 * Los archivos de entrada más todo lo que importan, recursivamente (mismas reglas que
 * evals/cargador.mjs: "@/" es src/, imports relativos sin extensión). Así un cambio en
 * cualquier código del que depende la nota cambia la huella, sin una lista a mano.
 */
export function cierreDeImports(entradas: string[], raiz = RAIZ, excluir: string[] = []): string[] {
  const fuera = new Set(excluir.map((e) => resolve(raiz, e)));
  const vistos = new Set<string>();
  const pendientes = entradas.map((e) => resolve(raiz, e));
  while (pendientes.length) {
    const archivo = pendientes.pop() as string;
    if (vistos.has(archivo) || fuera.has(archivo)) continue;
    vistos.add(archivo);
    if (!/\.(ts|tsx)$/.test(archivo)) continue;
    for (const m of readFileSync(archivo, "utf8").matchAll(IMPORTS)) {
      const dep = resolverImport(m[1], archivo, raiz);
      if (dep) pendientes.push(dep);
    }
  }
  return [...vistos].map((a) => relative(raiz, a).replaceAll("\\", "/")).sort();
}

export function calcularHuella(archivos: string[], config: Record<string, unknown>, raiz = RAIZ): Huella {
  const componentes: Record<string, string> = {};
  for (const archivo of archivos) {
    const absoluto = resolve(raiz, archivo);
    const clave = relative(raiz, absoluto).replaceAll("\\", "/");
    componentes[clave] = hashTexto(readFileSync(absoluto, "utf8"));
  }
  componentes.config = hashTexto(JSON.stringify(ordenar(config)));
  const total = hashTexto(
    Object.keys(componentes)
      .sort()
      .map((k) => `${k}:${componentes[k]}`)
      .join("\n"),
  );
  return { total, componentes };
}

/** Nombres de los componentes que cambiaron, aparecieron o desaparecieron. */
export function cambiosEntre(actual: Huella, aprobada: Huella): string[] {
  const claves = new Set([...Object.keys(actual.componentes), ...Object.keys(aprobada.componentes)]);
  return [...claves].sort().flatMap((k) => {
    const a = actual.componentes[k];
    const b = aprobada.componentes[k];
    if (a === b) return [];
    if (!b) return [`${k} (nuevo)`];
    if (!a) return [`${k} (ya no está)`];
    return [k];
  });
}

export type Revision =
  | { estado: "aprobada"; aprobacion: Aprobacion }
  | { estado: "sin_aprobar" }
  | { estado: "cambio"; cambios: string[]; aprobacion: Aprobacion };

export function revisarHuella(actual: Huella, archivoAprobacion: string): Revision {
  if (!existsSync(archivoAprobacion)) return { estado: "sin_aprobar" };
  const aprobacion = JSON.parse(readFileSync(archivoAprobacion, "utf8")) as Aprobacion;
  if (aprobacion.total === actual.total) return { estado: "aprobada", aprobacion };
  return { estado: "cambio", cambios: cambiosEntre(actual, aprobacion), aprobacion };
}

export function aprobarHuella(
  actual: Huella,
  config: Record<string, unknown>,
  archivoAprobacion: string,
  aprobadaPor: string,
  motivo: string,
  fecha = new Date().toISOString(),
): Aprobacion {
  if (!motivo.trim()) throw new Error("Aprobar la huella exige un motivo: --aprobar-huella=\"por qué cambia el examen\"");
  const aprobacion: Aprobacion = { ...actual, config, fecha, aprobadaPor, motivo };
  writeFileSync(archivoAprobacion, JSON.stringify(aprobacion, null, 2) + "\n");
  return aprobacion;
}

/** Texto para la consola cuando la eval no puede correr. */
export function explicarRechazo(revision: Revision, comando: string): string {
  if (revision.estado === "aprobada") return "";
  const reaprobar = `  ${comando} -- --aprobar-huella="motivo del cambio" --aprobada-por="nombre"`;
  if (revision.estado === "sin_aprobar") {
    return `La eval no tiene una huella aprobada todavía. Si el examen actual es el correcto, aprobalo:\n${reaprobar}`;
  }
  return (
    `El examen cambió desde la última aprobación (${revision.aprobacion.fecha.slice(0, 10)}, ${revision.aprobacion.aprobadaPor}):\n` +
    revision.cambios.map((c) => `  - ${c}`).join("\n") +
    `\nUna nota con este examen no se compara con la línea base. Si el cambio es intencional, re-aprobalo:\n${reaprobar}`
  );
}

export const resumenHuella = (h: Huella) => corto(h.total);

/** "qwen/qwen3.8-max:free", "MiniMax-M3" y "minimax-m3" son el mismo juez. */
export const normalizarModelo = (id: string | undefined) =>
  (id ?? "").toLowerCase().replace(/^.*\//, "").replace(/:free$/, "");
