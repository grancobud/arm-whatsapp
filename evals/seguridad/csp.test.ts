import { test } from "node:test";
import assert from "node:assert/strict";
import { API_CSP, buildCsp } from "../../src/lib/csp.ts";

const directiva = (csp: string, nombre: string) => csp.split("; ").find((d) => d.startsWith(`${nombre} `)) ?? "";

test("en producción un script sin nonce no corre", () => {
  const csp = buildCsp("abc123", { isDev: false });
  const scripts = directiva(csp, "script-src");
  assert.match(scripts, /'nonce-abc123'/);
  assert.match(scripts, /'strict-dynamic'/);
  assert.doesNotMatch(scripts, /unsafe-inline/);
  assert.doesNotMatch(scripts, /unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /localhost/);
});

test("eval y los sockets locales son solo de desarrollo", () => {
  const csp = buildCsp("abc123", { isDev: true });
  assert.match(directiva(csp, "script-src"), /unsafe-eval/);
  assert.match(directiva(csp, "connect-src"), /ws:\/\/localhost:\*/);
});

test("permite conectarse a un Supabase propio sin abrir otros orígenes", () => {
  assert.match(directiva(buildCsp("x", { isDev: false, supabaseUrl: "http://127.0.0.1:54321" }), "connect-src"), /ws:\/\/127\.0\.0\.1:54321/);
  const nube = directiva(buildCsp("x", { isDev: false, supabaseUrl: "https://abc.supabase.co" }), "connect-src");
  assert.doesNotMatch(nube, /abc\.supabase\.co/);
  assert.match(nube, /\*\.supabase\.co/);
});

test("las rutas de API no cargan nada", () => {
  assert.match(API_CSP, /default-src 'none'/);
});
