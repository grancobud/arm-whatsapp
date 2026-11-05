import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyLimit,
  dailyRoom,
  DEFAULT_DAILY_LIMIT,
  hasOptOutInstruction,
  isMarketingOptOutError,
  messageErrorCode,
  OPT_OUT_LINE,
  shouldStopCampaign,
} from "../../src/features/arm/services/campaign-rules.ts";
import { hasCardOrBankNumber } from "../../src/features/inbox/services/sensitive-data.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { withBackup, type Complete } from "../../src/features/inbox/services/reply-review.ts";

test("el tope diario arranca en el de un número nuevo y se puede cambiar", () => {
  assert.equal(DEFAULT_DAILY_LIMIT, 250);
  assert.equal(dailyLimit(undefined), 250);
  assert.equal(dailyLimit("abc"), 250);
  assert.equal(dailyLimit("0"), 250);
  assert.equal(dailyLimit("2000"), 2000);
});

test("lugar que queda hoy", () => {
  assert.equal(dailyRoom(0, 250), 250);
  assert.equal(dailyRoom(249, 250), 1);
  assert.equal(dailyRoom(250, 250), 0);
  assert.equal(dailyRoom(300, 250), 0);
});

test("la plantilla tiene que decir cómo darse de baja", () => {
  assert.equal(hasOptOutInstruction(OPT_OUT_LINE), true);
  assert.equal(hasOptOutInstruction("Respondé STOP para salir"), true);
  assert.equal(hasOptOutInstruction("Tenemos 20% de descuento esta semana"), false);
  assert.equal(hasOptOutInstruction("Bajamos los precios"), false);
});

test("una campaña se frena recién con muchas fallas", () => {
  assert.equal(shouldStopCampaign(0, 9), false);
  assert.equal(shouldStopCampaign(0, 10), true);
  assert.equal(shouldStopCampaign(10, 10), true);
  assert.equal(shouldStopCampaign(100, 10), false);
});

test("código de error de Meta, venga donde venga", () => {
  assert.equal(messageErrorCode({ errorCode: "131050" }), "131050");
  assert.equal(messageErrorCode({ whatsappApiError: { code: 131050 } }), "131050");
  assert.equal(messageErrorCode({ errors: [{ code: 131049 }] }), "131049");
  assert.equal(messageErrorCode({}), null);
  assert.equal(isMarketingOptOutError("131050"), true);
  assert.equal(isMarketingOptOutError("131049"), false);
});

test("detecta tarjetas y cuentas sin confundir otros números", () => {
  assert.equal(hasCardOrBankNumber("mi tarjeta 4111 1111 1111 1111"), true);
  assert.equal(hasCardOrBankNumber("4111-1111-1111-1111"), true);
  assert.equal(hasCardOrBankNumber("CBU 0110599520000012345678"), true);
  assert.equal(hasCardOrBankNumber("mi celular es 3414567890"), false);
  assert.equal(hasCardOrBankNumber("turno el 06/11/2026 a las 15"), false);
  assert.equal(hasCardOrBankNumber("1234 5678 9012 3456"), false);
});

test("si el modelo del revisor falla, prueba con el otro", async () => {
  const ok = (text: string): Complete => async () => ({ text, inputTokens: 0, outputTokens: 0 });
  const falla: Complete = async () => {
    throw new Error("429");
  };
  const pedido = { system: "", prompt: "", temperature: 0, maxOutputTokens: 1, timeoutMs: 5_000 };
  assert.equal((await withBackup(ok("uno"), ok("dos"))(pedido)).text, "uno");
  assert.equal((await withBackup(falla, ok("dos"))(pedido)).text, "dos");
  await assert.rejects(withBackup(falla, falla)(pedido), /429/);
});

test("el modelo y su respaldo comparten el tiempo: entre los dos no se pasan", async () => {
  const pedido = { system: "", prompt: "", temperature: 0, maxOutputTokens: 1, timeoutMs: 0 };
  const tiempos: number[] = [];
  const lento = (ms: number, texto?: string): Complete => async (req) => {
    tiempos.push(req.timeoutMs);
    await new Promise((r) => setTimeout(r, ms));
    if (!texto) throw new Error("timeout");
    return { text: texto, inputTokens: 0, outputTokens: 0 };
  };

  // El primero agota su parte: el respaldo recibe solo lo que queda.
  assert.equal((await withBackup(lento(100), lento(0, "dos"))({ ...pedido, timeoutMs: 10_000 })).text, "dos");
  assert.equal(tiempos[0], 7_000);
  assert.ok(tiempos[1] <= 10_000 - 100 + 20 && tiempos[1] > 9_000, String(tiempos[1]));

  // Sin tiempo para el respaldo, no lo llama.
  tiempos.length = 0;
  await assert.rejects(withBackup(lento(30), lento(0, "dos"))({ ...pedido, timeoutMs: 1_020 }));
  assert.equal(tiempos.length, 1);
});

test("la regla de datos sensibles está en todos los prompts", () => {
  const out = buildSystemPrompt({ nowContext: "hoy", bizContext: "negocio", promptBase: "base" });
  assert.match(out, /números de tarjeta, cuentas bancarias ni documentos/);
});
