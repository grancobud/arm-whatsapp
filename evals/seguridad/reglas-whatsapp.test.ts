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
  countOptOuts,
  shouldStopForOptOuts,
  warmupLimit,
  workspaceDailyLimit,
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

test("el tope de un negocio solo acepta un nivel de Meta", () => {
  assert.equal(workspaceDailyLimit({ campaign_daily_limit: 1000 }, 250), 1000);
  assert.equal(workspaceDailyLimit({ campaign_daily_limit: 10000 }, 250), 10000);
  // Cualquier otra cosa cae en el tope general.
  assert.equal(workspaceDailyLimit({ campaign_daily_limit: 999999 }, 250), 250);
  assert.equal(workspaceDailyLimit({ campaign_daily_limit: "1000" }, 250), 250);
  assert.equal(workspaceDailyLimit({}, 250), 250);
  assert.equal(workspaceDailyLimit(null, 250), 250);
  // El arranque gradual sigue mandando aunque el negocio tenga un tope alto.
  assert.equal(warmupLimit(null, workspaceDailyLimit({ campaign_daily_limit: 10000 }, 250)), 50);
});

test("un número que nunca mandó campañas arranca de a poco", () => {
  assert.equal(warmupLimit(null, 250), 50);
  assert.equal(warmupLimit(0.5, 250), 50);
  assert.equal(warmupLimit(1, 250), 100);
  assert.equal(warmupLimit(3.9, 250), 200);
  assert.equal(warmupLimit(4, 250), 250);
  assert.equal(warmupLimit(400, 2000), 2000);
  // El arranque nunca supera el tope del negocio.
  assert.equal(warmupLimit(2, 80), 80);
});

test("la campaña se frena si muchos piden no recibir más", () => {
  assert.equal(shouldStopForOptOuts(100, 4), false);
  assert.equal(shouldStopForOptOuts(100, 5), true);
  assert.equal(shouldStopForOptOuts(200, 5), false);
  assert.equal(shouldStopForOptOuts(0, 0), false);
});

test("cuenta como baja la del chat después del envío y el «frenar promociones» de WhatsApp", () => {
  const sent = "2026-11-10T12:00:00Z";
  assert.equal(
    countOptOuts([
      { status: "sent", sent_at: sent, error: null, opt_out_at: "2026-11-10T13:00:00Z" },
      { status: "sent", sent_at: sent, error: null, opt_out_at: "2026-11-01T13:00:00Z" },
      { status: "sent", sent_at: sent, error: null, opt_out_at: null },
      { status: "failed", sent_at: null, error: "Meta 131050", opt_out_at: null },
      { status: "failed", sent_at: null, error: "Meta 131026", opt_out_at: null },
    ]),
    2,
  );
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
