// Cargador para correr código de src/ con Node sin compilar: resuelve el alias
// "@/" y los imports relativos sin extensión (".ts", "/index.ts"), como Next.
// Carga automáticamente .env.local si existe.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = new URL("../.env.local", import.meta.url);
if (existsSync(ENV_LOCAL) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(fileURLToPath(ENV_LOCAL));
  } catch {
    // Ignorar si hay error de formato
  }
}

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
