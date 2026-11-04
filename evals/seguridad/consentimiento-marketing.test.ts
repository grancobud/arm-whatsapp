import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReceiveMarketing,
  isMarketingTemplate,
  marketingConsentUpdate,
} from "../../src/features/inbox/services/marketing-consent.ts";

test("escribirle al negocio no alcanza para recibir promociones", () => {
  assert.equal(canReceiveMarketing({ opt_in: true, marketing_opt_in: false }), false);
  assert.equal(canReceiveMarketing({ opt_in: true }), false);
});

test("la baja gana aunque haya aceptado promociones", () => {
  assert.equal(canReceiveMarketing({ opt_in: false, marketing_opt_in: true }), false);
  assert.equal(canReceiveMarketing({ opt_in: true, marketing_opt_in: true }), true);
});

test("aceptar promociones pide de dónde salió el permiso", () => {
  assert.ok("error" in marketingConsentUpdate({ marketing_opt_in: true }));
  assert.ok("error" in marketingConsentUpdate({ marketing_opt_in: true, marketing_opt_in_source: "   " }));
  const ahora = new Date("2026-11-04T10:00:00Z");
  assert.deepEqual(
    marketingConsentUpdate({ marketing_opt_in: true, marketing_opt_in_source: " formulario web " }, ahora),
    { update: { marketing_opt_in: true, marketing_opt_in_at: ahora.toISOString(), marketing_opt_in_source: "formulario web" } },
  );
});

test("un contacto dado de baja no puede aceptar promociones", () => {
  assert.ok("error" in marketingConsentUpdate({ opt_in: false, marketing_opt_in: true, marketing_opt_in_source: "x" }));
});

test("retirar el permiso y no tocarlo", () => {
  assert.deepEqual(marketingConsentUpdate({ marketing_opt_in: false }), {
    update: { marketing_opt_in: false, marketing_opt_in_at: null },
  });
  assert.deepEqual(marketingConsentUpdate({ opt_in: true }), { update: {} });
});

test("la categoría de la plantilla vale en cualquier formato", () => {
  assert.equal(isMarketingTemplate("MARKETING"), true);
  assert.equal(isMarketingTemplate("marketing"), true);
  assert.equal(isMarketingTemplate("UTILITY"), false);
  assert.equal(isMarketingTemplate(null), false);
});
