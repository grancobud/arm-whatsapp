// Cargador para correr código de src/ con Node sin compilar: resuelve el alias
// "@/" y los imports relativos sin extensión (".ts", "/index.ts"), como Next.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2), SRC).href;
  const relativo = spec.startsWith(".") || spec.startsWith("file:");
  if (relativo && !/\.(ts|tsx|mjs|js|json)$/.test(spec)) {
    const base = new URL(spec, context.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidato = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidato))) return next(candidato.href, context);
    }
  }
  return next(spec, context);
}
