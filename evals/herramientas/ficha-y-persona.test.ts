import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRevertChange,
  decideContactUpdate,
  invalidContactValue,
} from "../../src/features/arm/services/contact-update-rules.ts";
import { requestHumanTool } from "../../src/features/tools/tools/request-human.ts";
import { updateContactTool } from "../../src/features/tools/tools/update-contact.ts";
import { computeFirstResponse } from "../../src/features/dashboard/services/first-response.ts";

test("un campo vacío se completa, uno igual no cambia y uno distinto lo decide una persona", () => {
  assert.equal(decideContactUpdate(null, "Juan"), "apply");
  assert.equal(decideContactUpdate("  ", "Juan"), "apply");
  assert.equal(decideContactUpdate("JUÁN", "juan"), "same");
  assert.equal(decideContactUpdate("Pedro", "Juan"), "propose");
});

test("el valor tiene que estar en las palabras del cliente", () => {
  assert.equal(invalidContactValue("email", "juan@mail.com", "mi mail es JUAN@mail.com"), null);
  assert.ok(invalidContactValue("email", "otro@mail.com", "mi mail es juan@mail.com"));
  assert.ok(invalidContactValue("email", "no-es-correo", "no-es-correo"));
  assert.equal(invalidContactValue("name", "José", "soy jose"), null);
  assert.ok(invalidContactValue("name", "12345678", "soy 12345678"));
  assert.ok(invalidContactValue("name", "<script>", "soy <script>"));
});

test("solo se deshace si nadie volvió a cambiar el campo", () => {
  assert.equal(canRevertChange("Juan", "juan"), true);
  assert.equal(canRevertChange("Pedro", "Juan"), false);
  assert.equal(canRevertChange(null, "Juan"), false);
});

test("en el chat de prueba las herramientas no tocan nada", async () => {
  const ctx = { workspaceId: "w1", conversationId: "", contactId: "" };
  const persona = await requestHumanTool.run({ reason: "se queja" }, ctx);
  assert.deepEqual([persona.ok, (persona.output as { simulated: boolean }).simulated], [true, true]);
  const ficha = await updateContactTool.run({ field: "name", value: "Juan", quote: "soy Juan" }, ctx);
  assert.deepEqual(ficha.output, { saved: false, simulated: true });
});

test("update_contact rechaza un dato inventado antes de tocar la base", async () => {
  const r = await updateContactTool.run(
    { field: "email", value: "falso@mail.com", quote: "no te doy mi mail" },
    { workspaceId: "w1", conversationId: "c1", contactId: "k1" },
  );
  assert.equal(r.ok, false);
});

const m = (conversation_id: string, direction: string, segundos: number, meta?: Record<string, unknown>) => ({
  conversation_id,
  direction,
  created_at: new Date(Date.UTC(2026, 10, 1, 12, 0, segundos)).toISOString(),
  meta: meta ?? null,
});

test("la primera respuesta se mide desde el primer mensaje sin contestar", () => {
  assert.equal(
    computeFirstResponse([m("c", "in", 0), m("c", "in", 10), m("c", "out", 30), m("c", "out", 40), m("c", "in", 50), m("c", "out", 60)]),
    20,
  );
});

test("el aviso de privacidad y las notas internas no cuentan como respuesta", () => {
  assert.equal(
    computeFirstResponse([m("c", "in", 0), m("c", "out", 1, { privacy_notice: true }), m("c", "out", 2, { internal: true }), m("c", "out", 40)]),
    40,
  );
});

test("sin respuestas no hay tiempo, y los mensajes salientes sueltos no cuentan", () => {
  assert.equal(computeFirstResponse([m("c", "in", 0)]), null);
  assert.equal(computeFirstResponse([m("c", "out", 0)]), null);
  assert.equal(computeFirstResponse([]), null);
});
