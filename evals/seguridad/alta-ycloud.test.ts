// Alta con una sola clave: qué número se conecta y qué webhook es el de la app.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectErrorMessage,
  YCloudConnectError,
  ownWebhook,
  pickNumber,
  ycloudWebhookUrl,
} from "@/features/inbox/services/ycloud-connect";

const ws = "2cc4801f-0111-4ff4-aba0-090e16fb6001";
const uno = { phoneNumber: "+5491111111111", verifiedName: "Negocio" };
const dos = { phoneNumber: "+5491122222222", verifiedName: null };

test("la dirección del webhook es la del negocio, sin barras de más", () => {
  assert.equal(
    ycloudWebhookUrl("https://arm.example.com/", ws),
    `https://arm.example.com/api/webhooks/ycloud?wsid=${ws}`,
  );
});

test("con un solo número no hay nada que elegir", () => {
  assert.deepEqual(pickNumber([uno]), { phone: uno.phoneNumber });
  assert.deepEqual(pickNumber([uno], ""), { phone: uno.phoneNumber });
});

test("con varios números la persona elige, y solo entre los de su cuenta", () => {
  assert.deepEqual(pickNumber([uno, dos]), { choose: [uno, dos] });
  assert.deepEqual(pickNumber([uno, dos], "54 9 11 2222-2222"), { phone: dos.phoneNumber });
  assert.ok("error" in pickNumber([uno, dos], "+5491199999999"));
  assert.ok("error" in pickNumber([]));
});

test("solo se reutiliza el webhook que apunta a este negocio", () => {
  const url = ycloudWebhookUrl("https://arm.example.com", ws);
  const ajeno = { id: "a", url: "https://arm.example.com/api/webhooks/ycloud?wsid=otro" };
  const propio = { id: "b", url };
  assert.equal(ownWebhook([ajeno], url), null);
  assert.equal(ownWebhook([ajeno, propio], url)?.id, "b");
});

test("el error que ve la persona no arrastra la respuesta cruda de YCloud", () => {
  const msg = connectErrorMessage(new YCloudConnectError(401, "YCloud GET /secreto → 401"));
  assert.match(msg, /clave/);
  assert.doesNotMatch(msg, /secreto/);
  assert.match(connectErrorMessage(new Error("fetch failed")), /No se pudo llegar/);
});
