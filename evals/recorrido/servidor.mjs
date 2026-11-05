// Levanta la app contra el Supabase local, con YCloud y el modelo falsos.
//   node evals/recorrido/servidor.mjs
// Se niega a correr contra otra base: el recorrido escribe y borra datos.
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = fileURLToPath(new URL(".", import.meta.url));
const raiz = join(aqui, "..", "..");
const status = JSON.parse(execSync("npx supabase status -o json", { cwd: raiz, encoding: "utf8" }));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) throw new Error(`Solo en local, no en ${status.API_URL}`);

const dir = join(aqui, "resultados");
mkdirSync(dir, { recursive: true });
const control = join(dir, "control.json");
const log = join(dir, "pedidos.jsonl");
writeFileSync(control, "{}");
writeFileSync(log, "");
const secretos = {
  url: status.API_URL,
  service: status.SERVICE_ROLE_KEY,
  cron: "laboratorio-cron",
  encriptar: createHash("sha256").update("laboratorio").digest("base64"),
  control,
  log,
};
writeFileSync(join(dir, "lab.json"), JSON.stringify(secretos, null, 2));

// Solo para el caso modeloReal. Sin esa clave, nada sale del laboratorio.
const real = {};
try {
  const principal = {};
  const anterior = { ...process.env };
  process.loadEnvFile(process.env.RECORRIDO_ENV ?? join(raiz, "..", "whatsapp-saas", ".env.local"));
  for (const k of ["LLM_API_KEY", "FREELLMAPI_KEY", "LLM_BASE_URL"]) {
    principal[k] = process.env[k];
    if (!(k in anterior)) delete process.env[k];
  }
  real.RECORRIDO_REAL_KEY = principal.LLM_API_KEY || principal.FREELLMAPI_KEY;
  real.RECORRIDO_REAL_BASE = principal.LLM_BASE_URL || "http://localhost:31415/v1";
} catch {}
console.log(`Modelo real disponible: ${real.RECORRIDO_REAL_KEY ? "sí" : "no"}`);

const env = {
  ...process.env,
  ...real,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_APP_URL: "http://localhost:3101",
  CRON_SECRET: secretos.cron,
  BUFFER_PROCESS_SECRET: "laboratorio-buffer",
  ENCRYPTION_KEY: secretos.encriptar,
  ENCRYPTION_KEY_VERSION: "v1",
  LLM_BASE_URL: "http://llm.lab.test/v1",
  LLM_API_KEY: "falsa",
  OPENROUTER_API_KEY: "falsa",
  OPENROUTER_DEFAULT_MODEL: "auto",
  OPENROUTER_FALLBACK_MODELS: "auto",
  REPLY_REVIEW: "off",
  RESEND_API_KEY: "falsa",
  ALERT_EMAIL_TO: "laboratorio@ejemplo.test",
  NEXT_TELEMETRY_DISABLED: "1",
  RECORRIDO_CONTROL: control,
  RECORRIDO_LOG: log,
  NODE_OPTIONS: `--import ${pathToFileURL(join(aqui, "laboratorio-fetch.mjs")).href}`,
};
const hijo = spawn("npx", ["next", "dev", "--turbopack", "--port", "3101"], { cwd: raiz, env, stdio: "inherit", shell: true });
hijo.on("exit", (code) => process.exit(code ?? 0));
