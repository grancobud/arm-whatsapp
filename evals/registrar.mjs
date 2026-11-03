import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = new URL("../.env.local", import.meta.url);
if (existsSync(ENV_LOCAL) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(fileURLToPath(ENV_LOCAL));
  } catch {
    // ignorar
  }
}

register("./cargador.mjs", import.meta.url);
