import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPublicUrl, isBlockedIp, safeLookup, validateWebhookUrl } from "../../src/features/tools/services/ssrf-guard.ts";

test("direcciones internas bloqueadas, en IPv4 e IPv6", () => {
  for (const ip of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "224.0.0.1",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::a9fe:a9fe",
    "no-es-una-ip",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("direcciones públicas permitidas", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("el filtro rechaza IP internas escritas en la URL y http si no se permite", async () => {
  assert.ok(await validateWebhookUrl("https://[::1]/"));
  assert.ok(await validateWebhookUrl("https://[::ffff:127.0.0.1]/"));
  assert.ok(await validateWebhookUrl("https://2130706433/"));
  assert.ok(await validateWebhookUrl("http://8.8.8.8/"));
  assert.equal(await validateWebhookUrl("http://8.8.8.8/", { allowHttp: true, fetchImpl: globalThis.fetch }), null);
});

test("una redirección a una dirección interna no se sigue", async (t) => {
  const pedidas: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    pedidas.push(url);
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
  });
  await assert.rejects(fetchPublicUrl("http://8.8.8.8/", {}, { allowHttp: true, fetchImpl: globalThis.fetch }), /no permitida/);
  assert.deepEqual(pedidas, ["http://8.8.8.8/"]);
});

test("las redirecciones públicas se siguen hasta un tope", async (t) => {
  let saltos = 0;
  t.mock.method(globalThis, "fetch", async () => {
    saltos++;
    return new Response(null, { status: 302, headers: { location: "http://8.8.4.4/" } });
  });
  await assert.rejects(fetchPublicUrl("http://8.8.8.8/", {}, { allowHttp: true, fetchImpl: globalThis.fetch }), /demasiadas/);
  assert.equal(saltos, 4);
});

const resolverComo = (...ips: string[]) => async () => ips.map((address) => ({ address, family: 4 }));
const preguntar = (ips: string[], all = false) =>
  new Promise<{ err: Error | null; address: unknown }>((resolve) => {
    safeLookup("ejemplo.test", { all }, (err, address) => resolve({ err, address }), resolverComo(...ips));
  });

test("al conectarse, un host que ahora apunta a una dirección interna se rechaza", async () => {
  assert.match((await preguntar(["169.254.169.254"])).err?.message ?? "", /no permitida/);
  assert.match((await preguntar(["8.8.8.8", "10.0.0.1"], true)).err?.message ?? "", /no permitida/);
  assert.match((await preguntar([])).err?.message ?? "", /no permitida/);
});

test("al conectarse, una dirección pública pasa", async () => {
  const uno = await preguntar(["8.8.8.8"]);
  assert.deepEqual([uno.err, uno.address], [null, "8.8.8.8"]);
  const todos = await preguntar(["8.8.8.8", "1.1.1.1"], true);
  assert.equal((todos.address as unknown[]).length, 2);
});
