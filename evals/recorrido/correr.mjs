// Recorrido de WhatsApp simulado: un webhook firmado como los de YCloud entra por la
// ruta real y se sigue hasta el envío, con YCloud y el modelo falsos (laboratorio-fetch.mjs).
// Mide el camino y las fallas, no la calidad del modelo. No gasta cupo.
//
//   1. npx supabase start
//   2. node evals/recorrido/servidor.mjs   (o el preview "arm-recorrido")
//   3. node --import ./evals/registrar.mjs evals/recorrido/correr.mjs [caso]

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const lab = JSON.parse(readFileSync(new URL("./resultados/lab.json", import.meta.url), "utf8"));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(lab.url)) throw new Error("Solo en local");
process.env.ENCRYPTION_KEY = lab.encriptar;
process.env.ENCRYPTION_KEY_VERSION = "v1";
const { encryptCredentials } = await import("../../src/shared/lib/integration-secrets.ts");

const APP = "http://localhost:3101";
const db = createClient(lab.url, lab.service, { auth: { persistSession: false } });
const SECRETO = "secreto-del-webhook";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const controlar = (c) => writeFileSync(lab.control, JSON.stringify(c));
const pedidos = () =>
  readFileSync(lab.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function must(promesa, etiqueta) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${etiqueta}: ${error.message}`);
  return data;
}

async function crearCliente(slug, telefono) {
  const w = await must(
    db.from("workspaces").upsert({ name: `Recorrido ${slug}`, slug: `reco-${slug}` }, { onConflict: "slug" }).select().single(),
    "workspace",
  );
  const credentials = await encryptCredentials(
    { ycloud_api_key: "clave-falsa", webhook_signing_secret: SECRETO },
    w.id,
    "ycloud",
  );
  await must(
    db.from("integrations").upsert(
      { workspace_id: w.id, provider: "ycloud", enabled: true, credentials, config: { phone_number: telefono, buffer_silence_seconds: 3 } },
      { onConflict: "workspace_id,provider" },
    ),
    "integración",
  );
  await must(db.from("business_info").upsert({ workspace_id: w.id, structured: { name: "Barbería Lab" } }, { onConflict: "workspace_id" }).select().maybeSingle().then((r) => (r.error?.code === "42P01" ? { data: null, error: null } : r)), "negocio").catch(() => {});
  const tools = await must(db.from("tools").select("id, key").in("key", ["request_human", "update_contact"]), "herramientas");
  for (const t of tools) {
    await db.from("tool_configs").upsert({ workspace_id: w.id, tool_id: t.id, enabled: true }, { onConflict: "workspace_id,tool_id" });
  }
  return { id: w.id, telefono };
}

function evento(telefono, de, texto, wamid = `wamid.${randomUUID()}`, tipo = "text") {
  const contenido = tipo === "text" ? { text: { body: texto } } : { [tipo]: { id: "m1", link: "https://api.ycloud.com/media/m1", mime_type: "image/webp" } };
  return {
    id: `ev-${randomUUID()}`,
    type: "whatsapp.inbound_message.received",
    createTime: new Date().toISOString(),
    whatsappInboundMessage: {
      id: randomUUID(), wamid, from: de, to: telefono, type: tipo,
      customerProfile: { name: "Cliente Lab" }, sendTime: new Date().toISOString(), ...contenido,
    },
  };
}

function firmar(raw, secreto = SECRETO, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},s=${createHmac("sha256", secreto).update(`${ts}.${raw}`).digest("hex")}`;
}

async function webhook(body, { firma, query = "" } = {}) {
  const raw = JSON.stringify(body);
  const headers = { "content-type": "application/json" };
  const f = firma === undefined ? firmar(raw) : firma;
  if (f) headers["YCloud-Signature"] = typeof f === "function" ? f(raw) : f;
  const res = await fetch(`${APP}/api/webhooks/ycloud${query}`, { method: "POST", headers, body: raw });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// Otro rango en cada corrida: la base del laboratorio conserva las anteriores.
let telefonoCaso = 5491000000000 + (Date.now() % 900000) * 100;
const nuevoCliente = () => `+${++telefonoCaso}`;

async function conversacionDe(workspaceId, telefono) {
  const c = await db.from("contacts").select("id, name, email, opt_in").eq("workspace_id", workspaceId).eq("phone", telefono).maybeSingle();
  if (!c.data) return { contacto: null, conversacion: null, mensajes: [] };
  const v = await db.from("conversations").select("id, state, ai_enabled").eq("contact_id", c.data.id).maybeSingle();
  const m = v.data
    ? await db.from("messages").select("direction, body, status, wamid, type, meta").eq("conversation_id", v.data.id).order("created_at")
    : { data: [] };
  return { contacto: c.data, conversacion: v.data, mensajes: m.data ?? [] };
}

const salientes = (r) => r.mensajes.filter((m) => m.direction === "out");
/** Las respuestas del agente, sin el aviso de privacidad del primer mensaje. */
const respuestas = (r) => salientes(r).filter((m) => !/asistente|privacidad|BAJA/i.test(m.body ?? "") || /Respuesta de prueba/.test(m.body ?? ""));

async function esperar(cond, ms = 20_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const v = await cond();
    if (v) return v;
    await dormir(400);
  }
  return null;
}

async function eventos(workspaceId, tipo, desde) {
  const { data } = await db.from("events").select("type, level, payload, conversation_id").eq("workspace_id", workspaceId).eq("type", tipo).gte("created_at", desde);
  return data ?? [];
}

/** Hace vencer los lotes de la conversación y corre el cron, como el minuto siguiente. */
async function cronYa(conversationId) {
  if (conversationId) {
    await db.from("message_batches").update({ flush_at: new Date(Date.now() - 1000).toISOString() }).eq("conversation_id", conversationId).eq("status", "buffering");
  }
  const res = await fetch(`${APP}/api/cron/buffer-flush`, { headers: { Authorization: `Bearer ${lab.cron}` } });
  return res.json().catch(() => ({ status: res.status }));
}

// En producción el cron corre cada minuto y levanta lo que el camino rápido no alcanzó.
setInterval(() => {
  fetch(`${APP}/api/cron/buffer-flush`, { headers: { Authorization: `Bearer ${lab.cron}` } }).catch(() => {});
}, 15_000).unref();

const resultados = [];
function chequear(caso, nombre, ok, detalle = "") {
  resultados.push({ caso, nombre, ok: !!ok, detalle: String(detalle).slice(0, 220) });
  console.log(`  ${ok ? "✅" : "❌"} ${nombre}${!ok && detalle ? `: ${String(detalle).slice(0, 180)}` : ""}`);
}

const TEXTO = "Respuesta de prueba del modelo.";

const casos = {
  async normal({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    const r0 = await webhook(evento(a.telefono, de, "Hola, cuánto sale el corte?"));
    chequear("normal", "el webhook responde 200 y queda en el lote", r0.status === 200 && r0.json.buffered, JSON.stringify(r0));
    const r = await esperar(async () => {
      const x = await conversacionDe(a.id, de);
      return salientes(x).some((m) => m.body?.includes(TEXTO)) ? x : null;
    }, 30_000);
    chequear("normal", "la respuesta sale por YCloud", r, "no apareció el mensaje de salida");
    if (!r) return;
    const salida = salientes(r).find((m) => m.body?.includes(TEXTO));
    chequear("normal", "queda guardada con su identificador", salida?.wamid, JSON.stringify(salida));
    chequear("normal", "el envío llegó a YCloud con el teléfono correcto", pedidos().some((p) => p.destino === "ycloud" && p.body?.includes(de.replace("+", "")) && p.body?.includes(TEXTO)));
    const lote = await db.from("message_batches").select("status").eq("conversation_id", r.conversacion.id);
    chequear("normal", "el lote queda procesado", lote.data?.every((b) => b.status === "processed"), JSON.stringify(lote.data));
    console.log(`     salidas: ${salientes(r).map((m) => (m.body ?? "").slice(0, 60)).join(" | ")}`);

    const segundo = await webhook(evento(a.telefono, de, "Gracias"));
    chequear("normal", "el segundo mensaje también entra", segundo.status === 200);
    const r2 = await esperar(async () => {
      const x = await conversacionDe(a.id, de);
      return salientes(x).filter((m) => m.body?.includes(TEXTO)).length >= 2 ? x : null;
    }, 30_000);
    chequear("normal", "responde el segundo mensaje", r2);
    if (r2) {
      const avisos = salientes(r2).filter((m) => !m.body?.includes(TEXTO));
      chequear("normal", "el aviso de privacidad sale una sola vez", avisos.length <= 1, `${avisos.length} avisos`);
    }

    // Estados de entrega
    const wamid = salida.wamid;
    const estado = (s, extra = {}) => webhook({ id: `ev-${randomUUID()}`, type: "whatsapp.message.updated", whatsappMessage: { wamid, status: s, ...extra } }, { query: `?wsid=${a.id}` });
    const leer = async () => (await db.from("messages").select("status").eq("wamid", wamid).single()).data?.status;
    await estado("delivered");
    chequear("normal", "pasa a entregado", (await leer()) === "delivered", await leer());
    await estado("read");
    await estado("delivered");
    chequear("normal", "un estado viejo no lo hace retroceder", (await leer()) === "read", await leer());
  },

  async firmas({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    const ev = () => evento(a.telefono, de, "intento sin permiso");
    chequear("firmas", "sin firma: 401", (await webhook(ev(), { firma: null })).status === 401);
    chequear("firmas", "firma con otro secreto: 401", (await webhook(ev(), { firma: (raw) => firmar(raw, "otro") })).status === 401);
    chequear("firmas", "firma vieja (10 min): 401", (await webhook(ev(), { firma: (raw) => firmar(raw, SECRETO, Math.floor(Date.now() / 1000) - 600) })).status === 401);
    chequear("firmas", "JSON roto: 400", (await fetch(`${APP}/api/webhooks/ycloud`, { method: "POST", body: "{roto" })).status === 400);
    const estado = await webhook({ type: "whatsapp.message.updated", whatsappMessage: { wamid: "x", status: "read" } }, { firma: null, query: `?wsid=${a.id}` });
    chequear("firmas", "estado de entrega sin firma: 401", estado.status === 401, estado.status);
    const r = await conversacionDe(a.id, de);
    chequear("firmas", "nada quedó guardado", !r.contacto, JSON.stringify(r.contacto));
    const cron = await fetch(`${APP}/api/cron/buffer-flush`);
    chequear("firmas", "el cron sin clave: 401", cron.status === 401, cron.status);
  },

  async duplicados({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    const wamid = `wamid.dup.${randomUUID()}`;
    const ev = evento(a.telefono, de, "mensaje repetido por el proveedor", wamid);
    await webhook(ev);
    const segundo = await webhook({ ...ev, id: `ev-${randomUUID()}` });
    chequear("duplicados", "el segundo se reconoce como duplicado", segundo.json.dedup, JSON.stringify(segundo));
    const r = await esperar(async () => {
      const x = await conversacionDe(a.id, de);
      return salientes(x).some((m) => m.body?.includes(TEXTO)) ? x : null;
    }, 30_000);
    await dormir(5000);
    const x = await conversacionDe(a.id, de);
    chequear("duplicados", "una sola entrada guardada", x.mensajes.filter((m) => m.direction === "in").length === 1);
    chequear("duplicados", "una sola respuesta", r && salientes(x).filter((m) => m.body?.includes(TEXTO)).length === 1, salientes(x).length);
  },

  async rafaga({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Hola"));
    await dormir(500);
    await webhook(evento(a.telefono, de, "quería saber el precio"));
    await dormir(500);
    await webhook(evento(a.telefono, de, "del corte"));
    const r = await esperar(async () => {
      const x = await conversacionDe(a.id, de);
      return salientes(x).some((m) => m.body?.includes(TEXTO)) ? x : null;
    }, 30_000);
    await dormir(6000);
    const x = await conversacionDe(a.id, de);
    chequear("rafaga", "tres mensajes, una sola respuesta", r && salientes(x).filter((m) => m.body?.includes(TEXTO)).length === 1, salientes(x).map((m) => m.body).join(" | "));
    const alModelo = pedidos().filter((p) => p.destino === "modelo" && String(p.ultimo).includes("del corte"));
    chequear("rafaga", "el modelo recibe los tres juntos", alModelo.some((p) => String(p.ultimo).includes("Hola") && String(p.ultimo).includes("precio")), JSON.stringify(alModelo.at(-1)?.ultimo));
  },

  async baja({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "BAJA"));
    let x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return y.contacto ? y : null;
    }, 8000);
    await dormir(5000);
    x = await conversacionDe(a.id, de);
    chequear("baja", "queda dado de baja", x.contacto?.opt_in === false, JSON.stringify(x.contacto));
    chequear("baja", "el modelo no responde", !salientes(x).some((m) => m.body?.includes(TEXTO)));
    console.log(`     salidas: ${salientes(x).map((m) => (m.body ?? "").slice(0, 80)).join(" | ")}`);
    await webhook(evento(a.telefono, de, "¿Cuánto sale?"));
    await dormir(6000);
    x = await conversacionDe(a.id, de);
    chequear("baja", "un mensaje nuevo no lo da de alta ni le contesta la IA", x.contacto?.opt_in === false && !salientes(x).some((m) => m.body?.includes(TEXTO)), JSON.stringify(x.contacto));
    await webhook(evento(a.telefono, de, "ALTA"));
    await dormir(1500);
    x = await conversacionDe(a.id, de);
    chequear("baja", "ALTA lo vuelve a activar", x.contacto?.opt_in === true, JSON.stringify(x.contacto));
  },

  async iaApagada({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Primer mensaje"));
    const x0 = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return salientes(y).some((m) => m.body?.includes(TEXTO)) ? y : null;
    }, 30_000);
    if (!x0) return chequear("iaApagada", "preparación", false);
    await db.from("conversations").update({ ai_enabled: false }).eq("id", x0.conversacion.id);
    const r = await webhook(evento(a.telefono, de, "Segundo, lo atiende una persona"));
    await dormir(6000);
    const x = await conversacionDe(a.id, de);
    chequear("iaApagada", "guarda el mensaje", x.mensajes.some((m) => m.body?.includes("Segundo")));
    chequear("iaApagada", "no responde la IA", salientes(x).filter((m) => m.body?.includes(TEXTO)).length === 1 && r.json.ai === false, JSON.stringify(r));
  },

  async falloEnvio({ a }) {
    const desde = new Date().toISOString();
    controlar({ texto: TEXTO, ycloud: "500" });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Hola, YCloud está caído"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return salientes(y).some((m) => m.status === "failed" && m.body?.includes(TEXTO)) ? y : null;
    }, 30_000);
    chequear("falloEnvio", "el mensaje queda como fallido", x, "no quedó registrado");
    const fallos = await eventos(a.id, "dispatch_failure", desde);
    chequear("falloEnvio", "queda el evento dispatch_failure", fallos.length > 0);
    chequear("falloEnvio", "ese evento dispara una alerta", fallos.some((e) => e.level === "error"), JSON.stringify(fallos[0]));
    if (!x) return;
    console.log(`     estado: ${x.conversacion.state}, lotes: ${JSON.stringify((await db.from("message_batches").select("status, meta").eq("conversation_id", x.conversacion.id)).data?.map((b) => [b.status, b.meta?.attempts]))}`);

    await dormir(1500);
    const luego = await conversacionDe(a.id, de);
    chequear("falloEnvio", "una persona se entera en la Bandeja", luego.conversacion.state === "handoff_pending", luego.conversacion.state);
    // YCloud vuelve: la IA no responde de nuevo por su cuenta, para no duplicar.
    controlar({ texto: TEXTO });
    await cronYa(x.conversacion.id);
    await dormir(1500);
    const y = await conversacionDe(a.id, de);
    chequear("falloEnvio", "no se reenvía solo", salientes(y).filter((m) => m.body?.includes(TEXTO) && m.status !== "failed").length === 0);
  },

  async respaldo({ a }) {
    const desde = new Date().toISOString();
    controlar({ texto: TEXTO, modelo: "429", respaldo: "ok" });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Sin cupo en el proveedor principal"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return salientes(y).some((m) => m.body?.includes(TEXTO)) ? y : null;
    }, 30_000);
    chequear("respaldo", "responde por el modelo de respaldo", x, "sin respuesta");
    chequear("respaldo", "avisa del cambio de proveedor", (await eventos(a.id, "llm_failover", desde)).length > 0);
  },

  async sinCupo({ a }) {
    const desde = new Date().toISOString();
    controlar({ texto: TEXTO, modelo: "429", respaldo: "429" });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Quiero saber el precio"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return y.conversacion ? y : null;
    }, 8000);
    if (!x) return chequear("sinCupo", "preparación", false);
    // Cada intento vencido corre con el cron, como pasaría minuto a minuto.
    let intentos = [];
    for (let i = 0; i < 7; i++) {
      await dormir(i === 0 ? 5000 : 1000);
      await cronYa(x.conversacion.id);
      const lotes = (await db.from("message_batches").select("status, meta").eq("conversation_id", x.conversacion.id)).data ?? [];
      intentos = lotes.map((b) => [b.status, b.meta?.attempts]);
      if (lotes.every((b) => b.status === "cancelled" || b.status === "processed")) break;
    }
    console.log(`     lotes: ${JSON.stringify(intentos)}`);
    const y = await conversacionDe(a.id, de);
    const muerto = await eventos(a.id, "batch_dead_letter", desde);
    chequear("sinCupo", "tras los reintentos queda registrado y alerta", muerto.some((e) => e.level === "error"), JSON.stringify(intentos));
    chequear("sinCupo", "una persona se entera en la Bandeja", ["handoff_pending", "human_active"].includes(y.conversacion.state), `estado: ${y.conversacion.state}`);
    console.log(`     salidas: ${salientes(y).map((m) => (m.body ?? "").slice(0, 70)).join(" | ")}`);
    chequear("sinCupo", "el cliente recibe el aviso", salientes(y).length >= 2, `${salientes(y).length} salidas`);
  },

  async modeloColgado({ a }) {
    controlar({ texto: TEXTO, modelo: "colgado", respaldo: "colgado" });
    const de = nuevoCliente();
    const inicio = Date.now();
    await webhook(evento(a.telefono, de, "El modelo no contesta"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      if (!y.conversacion) return null;
      const lotes = (await db.from("message_batches").select("status, meta").eq("conversation_id", y.conversacion.id)).data ?? [];
      return lotes.some((b) => b.meta?.last_error) ? { y, lotes } : null;
    }, 90_000);
    chequear("modeloColgado", "el turno se corta y queda para reintentar", x, "siguió colgado 90 s");
    console.log(`     cortó a los ${Math.round((Date.now() - inicio) / 1000)} s; ${JSON.stringify(x?.lotes?.map((b) => [b.status, String(b.meta?.last_error).slice(0, 70)]))}`);
  },

  async queja({ a }) {
    controlar({ texto: "Uy, qué mal." });
    const de = nuevoCliente();
    const inicio = Date.now();
    await webhook(evento(a.telefono, de, "Vine ayer y el trabajo quedó mal hecho"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return salientes(y).some((m) => m.body?.includes("qué mal")) ? y : null;
    }, 120_000);
    console.log(`     respondió a los ${Math.round((Date.now() - inicio) / 1000)} s`);
    if (!x) {
      const y = await conversacionDe(a.id, de);
      console.log(`     estado ${y.conversacion?.state}; salidas: ${salientes(y).map((m) => m.body?.slice(0, 60)).join(" | ")}`);
    }
    chequear("queja", "responde", x);
    if (!x) return;
    const salida = salientes(x).find((m) => m.body?.includes("qué mal"));
    chequear("queja", "el cliente sabe que lo atiende una persona", /persona del equipo/.test(salida.body), salida.body);
    chequear("queja", "la conversación pasa a una persona", x.conversacion.state === "handoff_pending", x.conversacion.state);
    const avisos = salientes(x).filter((m) => /persona del equipo|te atiende un asesor/i.test(m.body ?? ""));
    chequear("queja", "no recibe dos avisos", avisos.length === 1, avisos.map((m) => m.body).join(" | "));
    controlar({ texto: TEXTO });
    await webhook(evento(a.telefono, de, "¿Hola? ¿Me atiende alguien?"));
    await dormir(6000);
    const y = await conversacionDe(a.id, de);
    chequear("queja", "la IA ya no responde en esa charla", !salientes(y).some((m) => m.body?.includes(TEXTO)), salientes(y).map((m) => m.body).join(" | "));
  },

  async ficha({ a }) {
    controlar({ texto: "¡Gracias, Laura!" });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Hola, soy Laura Méndez y mi correo es laura@ejemplo.com"));
    const x = await esperar(async () => {
      const y = await conversacionDe(a.id, de);
      return salientes(y).some((m) => m.body?.includes("Laura")) ? y : null;
    }, 30_000);
    chequear("ficha", "responde", x);
    if (!x) return;
    chequear("ficha", "guarda el correo aunque el modelo no use la herramienta", x.contacto.email === "laura@ejemplo.com", JSON.stringify(x.contacto));
    const cambios = (await db.from("contact_changes").select("field, new_value, quote").eq("contact_id", x.contacto.id)).data ?? [];
    chequear("ficha", "queda el historial con la cita", cambios.some((c) => c.field === "email" && c.quote), JSON.stringify(cambios));
    console.log(`     nombre en la ficha: ${x.contacto.name}; cambios: ${cambios.map((c) => c.field).join(",")}`);
  },

  async razonamiento({ a }) {
    controlar({ texto: "The user asks about prices. We need to obey policy and answer." });
    const de = nuevoCliente();
    await webhook(evento(a.telefono, de, "Precio del corte"));
    await dormir(9000);
    const x = await conversacionDe(a.id, de);
    chequear("razonamiento", "el razonamiento del modelo no llega al cliente", !salientes(x).some((m) => /The user asks/.test(m.body ?? "")), salientes(x).map((m) => m.body).join(" | "));
    const lotes = (await db.from("message_batches").select("status, meta").eq("conversation_id", x.conversacion?.id ?? randomUUID())).data ?? [];
    console.log(`     lotes: ${JSON.stringify(lotes.map((b) => [b.status, b.meta?.attempts, String(b.meta?.last_error ?? "").slice(0, 60)]))}`);
  },

  async otrosTipos({ a }) {
    controlar({ texto: TEXTO });
    const de = nuevoCliente();
    const r = await webhook(evento(a.telefono, de, null, undefined, "sticker"));
    chequear("otrosTipos", "un sticker no rompe el webhook", r.status === 200, JSON.stringify(r));
    await dormir(7000);
    const x = await conversacionDe(a.id, de);
    chequear("otrosTipos", "queda guardado", x.mensajes.some((m) => m.direction === "in"), JSON.stringify(x.mensajes));
    console.log(`     entrada: ${JSON.stringify(x.mensajes.filter((m) => m.direction === "in").map((m) => [m.type, m.body]))}; salidas: ${salientes(x).map((m) => (m.body ?? "").slice(0, 50)).join(" | ")}`);
    const largo = "x".repeat(9000);
    const de2 = nuevoCliente();
    const r2 = await webhook(evento(a.telefono, de2, largo));
    chequear("otrosTipos", "un mensaje de 9.000 caracteres no rompe nada", r2.status === 200, r2.status);
    await esperar(async () => pedidos().some((p) => p.destino === "modelo" && String(p.ultimo).startsWith("xxx")), 15_000);
    const alModelo = pedidos().filter((p) => p.destino === "modelo" && String(p.ultimo).startsWith("xxx")).at(-1);
    chequear("otrosTipos", "al modelo le llega recortado", alModelo && String(alModelo.ultimo).length <= 8200, String(alModelo?.ultimo ?? "").length);
  },

  // Solo con este caso sale algo del laboratorio: va por FreeLLMAPI y gasta cupo.
  async modeloReal({ a }) {
    controlar({ modelo: "real" });
    const pregunta = async (texto) => {
      const de = nuevoCliente();
      await webhook(evento(a.telefono, de, texto));
      const x = await esperar(async () => {
        const y = await conversacionDe(a.id, de);
        return salientes(y).length >= 2 ? y : null;
      }, 90_000);
      await dormir(1500);
      const y = await conversacionDe(a.id, de);
      console.log(`     «${texto}» → ${salientes(y).slice(1).map((m) => m.body).join(" | ") || "(sin respuesta)"} [${y.conversacion?.state}]`);
      return { x, y };
    };
    const hola = await pregunta("Hola, ¿qué tal? ¿Atienden hoy?");
    chequear("modeloReal", "responde por el webhook con el modelo real", hola.x);
    const queja = await pregunta("Es una vergüenza, me dejaron esperando una hora. Quiero hablar con una persona.");
    chequear("modeloReal", "una queja pasa a una persona", queja.y.conversacion?.state === "handoff_pending", queja.y.conversacion?.state);
    const datos = await pregunta("Mi mail es juan@ejemplo.com");
    chequear("modeloReal", "guarda el correo", datos.y.contacto?.email === "juan@ejemplo.com", JSON.stringify(datos.y.contacto));
    chequear("modeloReal", "no deduce el nombre del correo", datos.y.contacto?.name !== "juan" && !salientes(datos.y).slice(1).some((m) => /\bJuan\b/.test(m.body ?? "")), salientes(datos.y).at(-1)?.body);
  },

  async muchosClientes() {
    controlar({ texto: TEXTO });
    const clientes = [];
    for (let i = 0; i < 12; i++) clientes.push(await crearCliente(`n${i}`, `+54922000000${String(i).padStart(2, "0")}`));
    const rechazados = [];
    for (const [i, c] of clientes.entries()) {
      const r = await webhook(evento(c.telefono, nuevoCliente(), "Hola sin wsid"));
      if (r.status !== 200) rechazados.push(`n${i}:${r.status}`);
    }
    const total = (await db.from("integrations").select("workspace_id", { count: "exact", head: true }).eq("provider", "ycloud").eq("enabled", true)).count;
    chequear("muchosClientes", `con ${total} clientes, todos los mensajes sin wsid llegan`, rechazados.length === 0, `rechazados: ${rechazados.join(", ")}`);
    const conWsid = await webhook(evento(clientes.at(-1).telefono, nuevoCliente(), "Hola con wsid"), { query: `?wsid=${clientes.at(-1).id}` });
    chequear("muchosClientes", "con wsid llega siempre", conWsid.status === 200, conWsid.status);
  },
};

// La cola de lotes es global: lo que deja un caso no puede robarle el turno al siguiente.
async function limpiarCola() {
  await db.from("message_batches").update({ status: "cancelled" }).in("status", ["buffering", "processing"]);
}

const elegido = process.argv[2];
// El primer pedido compila la ruta en el servidor de desarrollo.
await fetch(`${APP}/api/cron/buffer-flush`, { headers: { Authorization: `Bearer ${lab.cron}` } }).catch(() => {});
await fetch(`${APP}/api/webhooks/ycloud`, { method: "POST", body: "{}" }).catch(() => {});
const a = await crearCliente("a", "+5491155550001");
writeFileSync(lab.log, "");
for (const [nombre, fn] of Object.entries(casos)) {
  if (elegido ? !elegido.split(",").includes(nombre) : nombre === "modeloReal") continue;
  await limpiarCola();
  console.log(`\n── ${nombre}`);
  try {
    await fn({ a });
  } catch (err) {
    chequear(nombre, "el caso terminó sin error", false, err?.stack ?? err);
  }
}
controlar({});
const mal = resultados.filter((r) => !r.ok);
console.log(`\n=== ${resultados.length - mal.length} de ${resultados.length} ===`);
for (const m of mal) console.log(`❌ ${m.caso} · ${m.nombre}: ${m.detalle}`);
writeFileSync(new URL("./resultados/ultima.json", import.meta.url), JSON.stringify(resultados, null, 2));
