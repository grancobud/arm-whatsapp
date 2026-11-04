import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_TASKS, FAQ, FIRST_STEPS, SCREENS } from "../../src/features/help/help-content.ts";
import { buildSetupStatus, type SetupFacts } from "../../src/features/help/setup-status.ts";
import { readSettingsTab, SETTINGS_TABS } from "../../src/features/settings/settings-tabs.ts";

const VACIO: SetupFacts = {
  ycloudEnabled: false,
  ycloudApiKey: false,
  phoneNumber: false,
  webhookSecret: false,
  businessName: false,
  kbDocuments: 0,
  activeAgentPublished: false,
  approvedTemplates: 0,
  teamMembers: 1,
};

test("un workspace recién creado tiene todo pendiente", () => {
  assert.ok(Object.values(buildSetupStatus(VACIO)).every((listo) => !listo));
});

test("WhatsApp cuenta como conectado solo con todos sus datos", () => {
  const casi = { ...VACIO, ycloudEnabled: true, ycloudApiKey: true, phoneNumber: true };
  assert.equal(buildSetupStatus(casi).whatsapp, false);
  assert.equal(buildSetupStatus({ ...casi, webhookSecret: true }).whatsapp, true);
});

test("el dueño solo no cuenta como equipo", () => {
  assert.equal(buildSetupStatus(VACIO).team, false);
  assert.equal(buildSetupStatus({ ...VACIO, teamMembers: 2 }).team, true);
});

test("todos los enlaces del manual llevan a una pantalla que existe", () => {
  const hrefs = [
    ...[...FIRST_STEPS, ...DAILY_TASKS].map((paso) => paso.link.href),
    ...SCREENS.map((pantalla) => pantalla.href),
    ...FAQ.flatMap((item) => (item.link ? [item.link.href] : [])),
  ];
  const rutas = new Set(["/inbox", "/revision", "/campanas", "/dashboard"]);
  for (const href of hrefs) {
    const [ruta, query] = href.split("?");
    if (ruta === "/settings") {
      const tab = new URLSearchParams(query).get("tab") ?? "";
      assert.ok((SETTINGS_TABS as readonly string[]).includes(tab), href);
    } else {
      assert.ok(rutas.has(ruta), href);
    }
  }
});

test("una solapa desconocida en la URL abre Agentes", () => {
  assert.equal(readSettingsTab("datos"), "datos");
  assert.equal(readSettingsTab("cualquiera"), "agentes");
  assert.equal(readSettingsTab(undefined), "agentes");
});
