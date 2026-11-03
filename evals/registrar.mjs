import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The evals that call a real model read their keys from .env.local. Unit
// tests (node --test) must run offline with no real keys, so they skip it.
const ENV_LOCAL = new URL("../.env.local", import.meta.url);
const UNIT_TESTS = process.execArgv.includes("--test");
if (!UNIT_TESTS && existsSync(ENV_LOCAL) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(fileURLToPath(ENV_LOCAL));
  } catch {
    // ignorar
  }
}

register("./cargador.mjs", import.meta.url);
