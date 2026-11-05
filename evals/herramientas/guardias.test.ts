import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asksForPerson,
  backHandoffPromise,
  HANDOFF_NOTICE,
  withHandoffNotice,
} from "../../src/features/inbox/services/handoff-promise.ts";
import {
  backContactData,
  dropNameFromEmail,
  statedContactData,
} from "../../src/features/inbox/services/contact-capture.ts";
import { BOOKING_FALLBACK, removeBookingOffer } from "../../src/features/inbox/services/booking-offer.ts";
import { invalidContactValue } from "../../src/features/arm/services/contact-update-rules.ts";
import type { Tool } from "../../src/features/tools/core/tool.ts";

const ctx = { workspaceId: "w", conversationId: "c", contactId: "k" };

function herramienta(name: string, sensitivity: Tool["sensitivity"], llamadas: unknown[]): Tool {
  return {
    name,
    description: "",
    sensitivity,
    schema: {},
    enabledFor: () => true,
    run: async (args: unknown) => {
      llamadas.push(args);
      return { ok: true, output: { saved: true } };
    },
  } as unknown as Tool;
}

// ── Queja o pedido de una persona ───────────────────────────────────────────

test("reconoce quejas y pedidos de una persona, también sin palabras como enojado", () => {
  for (const texto of [
    "Vine la semana pasada y el trabajo quedó mal hecho, tuve que ir a otro lado a que lo arreglen.",
    "Es una vergüenza, me dejaron esperando una hora.",
    "Quiero hablar con una persona ya.",
    "¿Puedo hablar con el dueño?",
    "Me cobraron de más la última vez",
    "Estoy re enojada con lo que pasó",
    "Nadie me responde hace dos días",
    "Quiero hacer un reclamo",
  ]) {
    assert.equal(asksForPerson(texto), true, texto);
  }
});

test("una charla normal no pasa a una persona", () => {
  for (const texto of [
    "Hola, ¿cuánto sale el corte?",
    "No quiero hablar con una persona, prefiero seguir por acá.",
    "No quedó mal, me encantó.",
    "¿Tenés turno para el viernes?",
    "Quiero sacar un turno",
    "Mi mail es juan@ejemplo.com",
    "Gracias por todo, quedó hermoso",
    "No quedó mal hecho, quedó bárbaro",
    "No me quedó mal, gracias",
    "¿Me hacés un 20% de descuento si voy hoy?",
  ]) {
    assert.equal(asksForPerson(texto), false, texto);
  }
});

test("una queja sin traspaso del modelo se traspasa igual", async () => {
  const llamadas: unknown[] = [];
  const tools = [herramienta("request_human", "write", llamadas)];
  const r = await backHandoffPromise({
    text: "Uy, qué mal.",
    tools,
    results: [],
    ctx,
    customerText: "El trabajo quedó mal hecho.",
  });
  assert.equal(r?.status, "ok");
  assert.equal(llamadas.length, 1);
});

test("el traspaso forzado no se repite ni pasa por encima de la aprobación del dueño", async () => {
  const llamadas: unknown[] = [];
  const customerText = "Quiero hablar con una persona";
  const hecha = { name: "request_human", status: "ok" as const, summary: "" };
  assert.equal(
    await backHandoffPromise({ text: "", tools: [herramienta("request_human", "write", llamadas)], results: [hecha], ctx, customerText }),
    null,
  );
  assert.equal(
    await backHandoffPromise({ text: "", tools: [herramienta("request_human", "sensitive", llamadas)], results: [], ctx, customerText }),
    null,
  );
  assert.equal(llamadas.length, 0);
});

test("el cliente se entera del traspaso una sola vez", () => {
  assert.equal(withHandoffNotice("Perdoná lo que pasó."), `Perdoná lo que pasó. ${HANDOFF_NOTICE}`);
  assert.equal(withHandoffNotice(""), HANDOFF_NOTICE);
  const yaDicho = "Perdoná. Una persona del equipo te va a atender.";
  assert.equal(withHandoffNotice(yaDicho), yaDicho);
});

// ── Datos del cliente ───────────────────────────────────────────────────────

test("toma los dos datos que el cliente afirma como propios", () => {
  assert.deepEqual(statedContactData("Hola, soy Laura Méndez y mi correo es laura@ejemplo.com"), [
    { field: "email", value: "laura@ejemplo.com", quote: "laura@ejemplo.com" },
    { field: "name", value: "Laura Méndez", quote: "soy Laura Méndez" },
  ]);
  assert.deepEqual(statedContactData("Mi mail es juan@ejemplo.com"), [
    { field: "email", value: "juan@ejemplo.com", quote: "juan@ejemplo.com" },
  ]);
  assert.deepEqual(statedContactData("ana@ejemplo.com"), [
    { field: "email", value: "ana@ejemplo.com", quote: "ana@ejemplo.com" },
  ]);
  assert.deepEqual(statedContactData("me llamo juan quiero un turno"), [
    { field: "name", value: "juan", quote: "me llamo juan" },
  ]);
  assert.deepEqual(statedContactData("Me llamo María de los Ángeles Pérez."), [
    { field: "name", value: "María de los Ángeles Pérez", quote: "Me llamo María de los Ángeles Pérez" },
  ]);
});

test("no guarda lo que no es del cliente ni lo que no es un nombre", () => {
  for (const texto of [
    "Les escribí a info@negocio.com y nadie me contestó",
    "El correo de mi jefe es jefe@empresa.com",
    "soy de Córdoba",
    "Soy Laura",
    "soy celíaco, ¿tienen opciones?",
    "mi nombre es importante para la factura",
    "te paso el mail de mi hermana\nhermana@ejemplo.com",
  ]) {
    assert.deepEqual(statedContactData(texto), [], texto);
  }
});

test("guarda solo lo que el modelo no guardó", async () => {
  const llamadas: { field: string }[] = [];
  const tools = [herramienta("update_contact", "write", llamadas)];
  const emailHecho = { name: "update_contact", status: "ok" as const, summary: "", args: { field: "email" } };
  const r = await backContactData({
    customerText: "Hola, soy Laura Méndez y mi correo es laura@ejemplo.com",
    tools,
    results: [emailHecho],
    ctx,
  });
  assert.equal(r.length, 1);
  assert.deepEqual(llamadas.map((l) => l.field), ["name"]);
});

test("si el intento del modelo falló, lo reintenta; si el dueño aprueba, no toca nada", async () => {
  const llamadas: unknown[] = [];
  const fallida = { name: "update_contact", status: "failed" as const, summary: "", args: { field: "email" } };
  await backContactData({
    customerText: "mi correo es a@ejemplo.com",
    tools: [herramienta("update_contact", "write", llamadas)],
    results: [fallida],
    ctx,
  });
  assert.equal(llamadas.length, 1);
  const r = await backContactData({
    customerText: "mi correo es a@ejemplo.com",
    tools: [herramienta("update_contact", "sensitive", llamadas)],
    results: [],
    ctx,
  });
  assert.deepEqual(r, []);
  assert.equal(llamadas.length, 1);
});

test("un nombre no se puede sacar del correo", () => {
  assert.ok(invalidContactValue("name", "juan", "Mi mail es juan@ejemplo.com"));
  assert.ok(invalidContactValue("name", "perez", "juan.perez@ejemplo.com"));
  assert.equal(invalidContactValue("name", "Juan", "Soy Juan, mi mail es juan@ejemplo.com"), null);
  assert.equal(invalidContactValue("email", "juan@ejemplo.com", "Mi mail es juan@ejemplo.com"), null);
});

test("saca del texto el nombre deducido del correo", () => {
  const cliente = "Mi mail es juan@ejemplo.com";
  assert.equal(dropNameFromEmail("¡Gracias, Juan! ¿En qué te ayudo?", cliente), "¡Gracias! ¿En qué te ayudo?");
  assert.equal(dropNameFromEmail("Juan, gracias por escribir.", cliente), "Gracias por escribir.");
  assert.equal(dropNameFromEmail("¡Hola Juan!", cliente), "¡Hola!");
});

test("deja el texto igual si el cliente dijo el nombre o si no hay nombre", () => {
  const dicho = "¡Gracias, Juan!";
  assert.equal(dropNameFromEmail(dicho, "Soy Juan, mi mail es juan@ejemplo.com"), dicho);
  const correo = "Te escribimos a juan@ejemplo.com cuando esté.";
  assert.equal(dropNameFromEmail(correo, "Mi mail es juan@ejemplo.com"), correo);
  assert.equal(dropNameFromEmail("¡Gracias, Juan!", "Hola, ¿tenés turno?"), "¡Gracias, Juan!");
  assert.equal(dropNameFromEmail("Juana te va a atender.", "Mi mail es juan@ejemplo.com"), "Juana te va a atender.");
  const palabraComun = "Ya le pasé la info al equipo.";
  assert.equal(dropNameFromEmail(palabraComun, "Les escribí a info@negocio.com y nadie me contestó"), palabraComun);
  assert.equal(dropNameFromEmail("Info no tengo, perdoná.", "Les escribí a info@negocio.com"), "Info no tengo, perdoná.");
  assert.equal(dropNameFromEmail("Tengo tu pedido de ventas.", "mi correo es ventas@negocio.com"), "Tengo tu pedido de ventas.");
});

// ── Ofertas de turno sin herramienta ────────────────────────────────────────

const SIN_AGENDA = ["request_human", "update_contact", "remember_fact"];

test("cambia la oferta de turno por el pase a una persona", () => {
  for (const [texto, queda] of [
    ["No, estamos cerrados. ¿Te gustaría agendar para otro día?", `No, estamos cerrados. ${BOOKING_FALLBACK}`],
    ["¿Querés reservar para algún día de la semana?", BOOKING_FALLBACK],
    ["Abrimos a las 9. Te agendo para mañana.", `Abrimos a las 9. ${BOOKING_FALLBACK}`],
    ["Sí, puedo ver la disponibilidad de turnos.", BOOKING_FALLBACK],
    ["¿Para qué día querés?", BOOKING_FALLBACK],
  ]) {
    const r = removeBookingOffer(texto, SIN_AGENDA);
    assert.equal(r.changed, true, texto);
    assert.equal(r.text, queda);
  }
});

test("no repite el pase a una persona si ya estaba en la respuesta", () => {
  const r = removeBookingOffer("¿Querés reservar? Si querés, te paso con una persona del equipo.", SIN_AGENDA);
  assert.deepEqual(r, { text: "Si querés, te paso con una persona del equipo.", changed: true });
});

test("no toca lo que no es una oferta de turno", () => {
  for (const texto of [
    "¡Hola! Para reservar un turno te paso con una persona del equipo.",
    "Si querés, te paso con una persona del equipo para coordinar el turno.",
    "¿Querés que te pase con alguien para sacar un turno?",
    "No puedo reservarte el turno, eso lo hace el equipo.",
    "El corte sale $5000. ¿Querés saber algo más?",
    "Para reservar hay que señar el 50%.",
    "Abrimos de 9 a 18.",
  ]) {
    assert.deepEqual(removeBookingOffer(texto, SIN_AGENDA), { text: texto, changed: false }, texto);
  }
});

test("con una herramienta que puede agendar, no toca nada", () => {
  const texto = "¿Querés reservar para el viernes?";
  for (const herramienta of ["check_availability", "schedule_highlevel", "schedule_link", "mcp_agenda", "custom_webhook"]) {
    assert.equal(removeBookingOffer(texto, [...SIN_AGENDA, herramienta]).changed, false, herramienta);
  }
});
