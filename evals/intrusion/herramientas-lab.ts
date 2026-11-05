// Prueba de punta a punta, contra el Supabase local: pasar a una persona, completar
// la ficha, proponer un cambio y borrar al contacto con su historial.
//   node --import ./evals/registrar.mjs evals/intrusion/herramientas-lab.ts <estado-lab.json>

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const lab = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^http:\/\/127\.0\.0\.1:/.test(lab.url)) throw new Error("Solo en local");
process.env.NEXT_PUBLIC_SUPABASE_URL = lab.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = lab.service;

const { requestHumanTool } = await import("../../src/features/tools/tools/request-human.ts");
const { updateContactTool } = await import("../../src/features/tools/tools/update-contact.ts");
const { eraseContact } = await import("../../src/features/privacy/services/contact-erasure.ts");

const db = createClient(lab.url, lab.service, { auth: { persistSession: false } });
const ctx = { workspaceId: lab.a.id, conversationId: lab.a.conversationId, contactId: lab.a.contactId };
const fila = async (tabla: string, id: string, columnas: string) =>
  (await db.from(tabla).select(columnas).eq("id", id).single()).data as unknown as Record<string, unknown>;

await db.from("conversations").update({ state: "ai_active", ai_enabled: true }).eq("id", ctx.conversationId);
await db.from("contacts").update({ email: null, name: "Nombre de perfil" }).eq("id", ctx.contactId);
await db.from("messages").insert({
  workspace_id: ctx.workspaceId,
  conversation_id: ctx.conversationId,
  direction: "in",
  type: "text",
  status: "delivered",
  body: "Soy Juana Pérez y mi mail es juana@ejemplo.test",
});

// Un dato vacío se completa y queda en el historial.
const correo = await updateContactTool.run({ field: "email", value: "juana@ejemplo.test", quote: "mi mail es juana@ejemplo.test" }, ctx);
assert.equal(correo.ok, true, correo.error);
assert.equal((await fila("contacts", ctx.contactId, "email")).email, "juana@ejemplo.test");
const historial = (await db.from("contact_changes").select("field, old_value, new_value").eq("contact_id", ctx.contactId)).data;
assert.deepEqual(historial, [{ field: "email", old_value: null, new_value: "juana@ejemplo.test" }]);
console.log("ok  completa un campo vacío y lo registra");

// Una cita que no está en la charla no pasa.
const falsa = await updateContactTool.run({ field: "email", value: "otro@ejemplo.test", quote: "mi mail es otro@ejemplo.test" }, ctx);
assert.equal(falsa.ok, false);
console.log("ok  rechaza una cita inventada");

// Un valor distinto queda para Revisión, sin cambiar la ficha.
const nombre = await updateContactTool.run({ field: "name", value: "Juana Pérez", quote: "Soy Juana Pérez" }, ctx);
assert.equal(nombre.requiresConfirmation, true);
assert.equal((await fila("contacts", ctx.contactId, "name")).name, "Nombre de perfil");
const propuestas = (await db.from("agent_proposals").select("id, status").eq("contact_id", ctx.contactId).eq("tool_name", "update_contact")).data ?? [];
assert.equal(propuestas.length, 1);
console.log("ok  un valor distinto queda como propuesta");

// Con la aprobación, se aplica.
const aprobado = await updateContactTool.run({ field: "name", value: "Juana Pérez", quote: "Soy Juana Pérez" }, ctx, { approvedProposalId: propuestas[0].id });
assert.equal(aprobado.ok, true, aprobado.error);
assert.equal((await fila("contacts", ctx.contactId, "name")).name, "Juana Pérez");
console.log("ok  con aprobación se aplica");

// Pasar a una persona cambia el estado y apaga la IA.
const persona = await requestHumanTool.run({ reason: "Se queja por una demora" }, ctx);
assert.equal(persona.ok, true, persona.error);
const conversacion = await fila("conversations", ctx.conversationId, "state, ai_enabled");
assert.deepEqual([conversacion.state, conversacion.ai_enabled], ["handoff_pending", false]);
const eventos = (await db.from("events").select("type").eq("conversation_id", ctx.conversationId).in("type", ["agent_requested_human", "handoff_ack_sent", "handoff_ack_failed"])).data ?? [];
assert.deepEqual(eventos.map((e) => e.type), ["agent_requested_human"]);
console.log("ok  pasa a una persona, sin aviso duplicado");

// Otra vez: ya la tiene una persona, no falla.
assert.equal((await requestHumanTool.run({ reason: "Otra vez" }, ctx)).ok, true);
console.log("ok  repetirlo no rompe nada");

// Un cliente nuevo nace con las herramientas básicas.
const { data: nuevo } = await db.from("workspaces").insert({ name: "Cliente nuevo", slug: `nuevo-${Date.now()}` }).select("id").single();
const { data: configs } = await db.from("tool_configs").select("tool:tools(key), enabled").eq("workspace_id", nuevo!.id);
const claves = (configs as unknown as { tool: { key: string }; enabled: boolean }[]).filter((c) => c.enabled).map((c) => c.tool.key).sort();
assert.deepEqual(claves, ["remember_fact", "request_human", "schedule_followup", "update_contact"]);
console.log("ok  un cliente nuevo nace con las herramientas básicas");

// Borrar al contacto se lleva el historial.
assert.equal(await eraseContact(db, ctx.workspaceId, ctx.contactId), true);
const restos = (await db.from("contact_changes").select("id").eq("contact_id", ctx.contactId)).data ?? [];
assert.equal(restos.length, 0);
console.log("ok  el borrado se lleva el historial");
