// Test sin red del respaldo de la IA: cuándo pasa a OpenRouter, cómo reescribe
// el pedido y que no se quede esperando a un servidor caído en cada mensaje.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createFailoverFetch,
  OPENROUTER_BASE_URL,
  resetPrimaryState,
  rewriteForBackup,
  shouldFailover,
} from "@/features/inbox/services/llm-failover";

const PRIMARY = "https://llm.ejemplo.com/v1";
const body = JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hola" }] });

beforeEach(() => resetPrimaryState());

function fakeFetch(primary: (n: number) => Response | Error) {
  const calls: Array<{ url: string; auth: string | null; model: string }> = [];
  let n = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      model: JSON.parse(String(init?.body)).model,
    });
    if (url.startsWith(PRIMARY)) {
      const r = primary(n++);
      if (r instanceof Error) throw r;
      return r;
    }
    return new Response('{"ok":"backup"}', { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

test("qué cuenta como caído", () => {
  for (const s of [500, 502, 503, 530, 429]) assert.equal(shouldFailover(s), true, String(s));
  for (const s of [200, 400, 401, 404]) assert.equal(shouldFailover(s), false, String(s));
});

test("reescribe URL, clave y modelo para OpenRouter", () => {
  const b = rewriteForBackup(`${PRIMARY}/chat/completions`, { body, headers: { authorization: "Bearer vieja" } }, PRIMARY, "sk-or", "modelo:free");
  assert.equal(b.url, `${OPENROUTER_BASE_URL}/chat/completions`);
  assert.equal(new Headers(b.init.headers).get("authorization"), "Bearer sk-or");
  assert.equal(JSON.parse(String(b.init.body)).model, "modelo:free");
});

test("si el principal anda, no toca OpenRouter", async () => {
  const f = fakeFetch(() => new Response("{}", { status: 200 }));
  const send = createFailoverFetch({ primaryBase: PRIMARY, backupKey: "sk-or", backupModels: ["m"], fetchImpl: f.impl });
  await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(f.calls.length, 1);
});

test("PC apagada (error de red o 530): contesta OpenRouter y avisa una sola vez por minuto", async () => {
  const reasons: string[] = [];
  const f = fakeFetch((n) => (n === 0 ? new TypeError("fetch failed") : new Response("", { status: 530 })));
  const send = createFailoverFetch({
    primaryBase: PRIMARY,
    backupKey: "sk-or",
    backupModels: ["modelo:free"],
    fetchImpl: f.impl,
    onFailover: (r) => reasons.push(r),
  });
  const res = await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(await res.text(), '{"ok":"backup"}');
  assert.deepEqual(reasons, ["fetch failed"]);
  // El siguiente mensaje no espera al principal caído: va directo al respaldo.
  await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(f.calls.filter((c) => c.url.startsWith(PRIMARY)).length, 1);
  assert.equal(f.calls.filter((c) => c.url.startsWith(OPENROUTER_BASE_URL)).length, 2);
  assert.equal(reasons.length, 1);
});

test("un 400 del principal no se reintenta en OpenRouter", async () => {
  const f = fakeFetch(() => new Response("{}", { status: 400 }));
  const send = createFailoverFetch({ primaryBase: PRIMARY, backupKey: "sk-or", backupModels: ["m"], fetchImpl: f.impl });
  const res = await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(res.status, 400);
  assert.equal(f.calls.length, 1);
});

test("sin clave de OpenRouter no hay respaldo: es un fetch común", async () => {
  const f = fakeFetch(() => new Response("", { status: 530 }));
  const send = createFailoverFetch({ primaryBase: PRIMARY, backupKey: "", backupModels: ["m"], fetchImpl: f.impl });
  const res = await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(res.status, 530);
  assert.equal(f.calls.length, 1);
});

test("si un modelo de respaldo ya no existe (404), prueba el siguiente", async () => {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(PRIMARY)) return new Response("", { status: 502 });
    const model = JSON.parse(String(init?.body)).model;
    seen.push(model);
    return new Response("{}", { status: model === "viejo:free" ? 404 : 200 });
  }) as typeof fetch;
  const send = createFailoverFetch({ primaryBase: PRIMARY, backupKey: "sk-or", backupModels: ["viejo:free", "openrouter/free"], fetchImpl: impl });
  const res = await send(`${PRIMARY}/chat/completions`, { method: "POST", body });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["viejo:free", "openrouter/free"]);
});

test("modelos de respaldo desde la variable o por defecto", async () => {
  const { backupModelsFromEnv, DEFAULT_BACKUP_MODELS } = await import("@/features/inbox/services/llm-failover");
  assert.deepEqual(backupModelsFromEnv(" a:free , b "), ["a:free", "b"]);
  assert.deepEqual(backupModelsFromEnv(""), DEFAULT_BACKUP_MODELS);
});
