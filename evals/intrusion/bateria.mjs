// Batería fija de la prueba de intrusión. Solo corre contra el laboratorio local.
//   node evals/intrusion/bateria.mjs <estado-lab.json> <salida.json>

import { readFileSync, writeFileSync } from "node:fs";

const lab = JSON.parse(readFileSync(process.argv[2], "utf8"));
const BASE = "http://localhost:3101";
if (!/^http:\/\/127\.0\.0\.1:/.test(lab.url)) throw new Error("Solo en local");

const { a, b, actors } = lab;
const hallazgos = [];
const resumen = { pedidos: 0, bien: 0, revisar: 0, falla: 0 };

function anotar(gravedad, prueba, detalle) {
  if (gravedad === "falla") resumen.falla++;
  else if (gravedad === "revisar") resumen.revisar++;
  else resumen.bien++;
  if (gravedad !== "bien") hallazgos.push({ gravedad, prueba, detalle: String(detalle).slice(0, 400) });
}

function cookieDe(actor) {
  if (!actor) return "";
  const value = `base64-${Buffer.from(JSON.stringify(actor.session)).toString("base64url")}`;
  const name = "sb-127-auth-token";
  if (value.length <= 3180) return `${name}=${value}`;
  const parts = value.match(/.{1,3180}/g);
  return parts.map((p, i) => `${name}.${i}=${p}`).join("; ");
}

async function web(actor, method, path, body, headers = {}) {
  resumen.pedidos++;
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      cookie: cookieDe(actor),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function rest(token, method, path, body, extra = {}) {
  resumen.pedidos++;
  const res = await fetch(`${lab.url}${path}`, {
    method,
    headers: {
      apikey: lab.anon,
      authorization: `Bearer ${token ?? lab.anon}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

const service = (method, path, body) =>
  fetch(`${lab.url}${path}`, {
    method,
    headers: { apikey: lab.service, authorization: `Bearer ${lab.service}`, "content-type": "application/json", prefer: "return=representation,count=exact" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), range: r.headers.get("content-range") }));

// ---------- Rutas ----------
const W = a.id;
const RUTAS = [
  ["GET", `/api/contacts/${a.contactId}/export`],
  ["PATCH", `/api/contacts/${a.contactId}`, { name: "HACKEADO" }],
  ["DELETE", `/api/contacts/${a.contactId}`],
  ["GET", `/api/conversations/${a.conversationId}/events`],
  ["POST", `/api/conversations/${a.conversationId}/handoff`, { action: "request" }],
  ["POST", `/api/conversations/${a.conversationId}/messages`, { body: "HACKEADO", type: "text" }],
  ["POST", `/api/conversations/${a.conversationId}/notes`, { content: "HACKEADO" }],
  ["POST", `/api/conversations/${a.conversationId}/take`, {}],
  ["PATCH", `/api/conversations/${a.conversationId}/toggle-ai`, { ai_enabled: false, enabled: false }],
  ["POST", `/api/inbox/media-url`, { path: `${W}/${a.conversationId}/x.jpg`, storagePath: `${W}/${a.conversationId}/x.jpg`, messageId: a.conversationId }],
  ["GET", `/api/tools/${W}`],
  ["PATCH", `/api/tools/${W}`, { toolKey: "custom_webhook", enabled: true }],
  ["POST", `/api/integrations/ycloud/test`, { workspaceId: W, apiKey: "x" }],
  ["GET", `/api/workspace/${W}/agents`],
  ["PATCH", `/api/workspace/${W}/agents`, { agentId: a.id, setActive: true }],
  ["POST", `/api/workspace/${W}/agents/${a.id}/test-chat`, { messages: [{ role: "user", content: "hola" }] }],
  ["GET", `/api/workspace/${W}/automations`],
  ["POST", `/api/workspace/${W}/automations`, { name: "x" }],
  ["GET", `/api/workspace/${W}/business-info`],
  ["PUT", `/api/workspace/${W}/business-info`, { structured: { name: "HACKEADO" }, free_text: "HACKEADO" }],
  ["GET", `/api/workspace/${W}/export`],
  ["GET", `/api/workspace/${W}/export?format=csv`],
  ["GET", `/api/workspace/${W}/integrations`],
  ["PUT", `/api/workspace/${W}/integrations`, { provider: "ycloud", config: {}, credentials: {} }],
  ["POST", `/api/workspace/${W}/integrations/test`, { provider: "ycloud" }],
  ["GET", `/api/workspace/${W}/integrations/highlevel/pipelines`],
  ["POST", `/api/workspace/${W}/integrations/highlevel/test`, {}],
  ["POST", `/api/workspace/${W}/jev/preview`, { text: "hola" }],
  ["PATCH", `/api/workspace/${W}/jev`, { enabled: true }],
  ["GET", `/api/workspace/${W}/kb`],
  ["POST", `/api/workspace/${W}/kb`, { title: "HACKEADO", content: "HACKEADO HACKEADO HACKEADO" }],
  ["GET", `/api/workspace/${W}/privacy`],
  ["PATCH", `/api/workspace/${W}/privacy`, { retentionMonths: 6 }],
  ["GET", `/api/workspace/${W}/prompts`],
  ["POST", `/api/workspace/${W}/prompts`, { name: "x", body: "HACKEADO" }],
  ["GET", `/api/workspace/${W}/setter`],
  ["GET", `/api/workspace/${W}/team`],
  ["POST", `/api/workspace/${W}/team`, { email: "b-admin@lab.test", role: "admin" }],
  ["POST", `/api/workspace/${W}/templates/generate`, { prompt: "x" }],
  ["GET", `/api/workspace/${W}/templates/library`],
  ["GET", `/api/workspace/${W}/templates`],
  ["POST", `/api/workspace/${W}/templates/sync`, {}],
  ["GET", `/api/agency/workspaces`],
  ["POST", `/api/agency/workspaces`, { name: "HACKEADO", slug: "hackeado", adminEmail: "x@lab.test" }],
];
const BLOQUEO = new Set([401, 403, 404, 307]);

for (const [method, path, body] of RUTAS) {
  // Las destructivas van al final, y solo como ajeno y anónimo: no deben pasar nunca.
  for (const [nombre, actor] of [["anónimo", null], ["admin de otro cliente", actors.bAdmin]]) {
    const r = await web(actor, method, path, body);
    const fuga = /SECRETO-a/.test(r.text);
    const prueba = `${nombre}: ${method} ${path.replace(W, "{clienteA}")}`;
    if (fuga) anotar("falla", prueba, `${r.status} con datos del otro cliente: ${r.text}`);
    else if (r.status >= 200 && r.status < 300 && /^\{"(agents|automations|documents|prompts|templates|members|rules)":\[\]\}$|"ok":false/.test(r.text)) anotar("revisar", prueba, `${r.status} sin datos: ${r.text}`);
    else if (r.status >= 200 && r.status < 300) anotar(path.startsWith("/api/agency") && method === "GET" ? "revisar" : "falla", prueba, `${r.status}: ${r.text}`);
    else if (BLOQUEO.has(r.status)) anotar("bien", prueba);
    else anotar("revisar", prueba, `${r.status}: ${r.text}`);
  }
}

// Rol más bajo: no debería modificar nada.
for (const [method, path, body] of RUTAS.filter(([m, p]) => m !== "GET" && !p.includes("/api/agency") && !p.includes("/team") && m !== "DELETE")) {
  const r = await web(actors.aViewer, method, path, body);
  const prueba = `lector del mismo cliente: ${method} ${path.replace(W, "{clienteA}")}`;
  if (r.status >= 200 && r.status < 300) anotar("falla", prueba, `${r.status}: ${r.text}`);
  else if (BLOQUEO.has(r.status)) anotar("bien", prueba);
  else anotar("revisar", prueba, `${r.status}: ${r.text}`);
}
for (const [path, nombre] of [[`/api/workspace/${W}/export`, "exportar todo"], [`/api/contacts/${a.contactId}/export`, "exportar contacto"], [`/api/workspace/${W}/integrations`, "ver integraciones"], [`/api/workspace/${W}/team`, "ver equipo"]]) {
  const r = await web(actors.aViewer, "GET", path);
  const prueba = `lector del mismo cliente: ${nombre}`;
  if (r.status >= 200 && r.status < 300) anotar("revisar", prueba, `${r.status}: ${r.text}`);
  else anotar("bien", prueba);
}

// ---------- Puertas de servicio ----------
const PUERTAS = [
  ["GET", "/api/cron/buffer-flush", undefined, {}],
  ["GET", "/api/cron/buffer-flush", undefined, { authorization: "Bearer undefined" }],
  ["GET", "/api/cron/retention", undefined, {}],
  ["GET", "/api/cron/retention", undefined, { authorization: "Bearer mal" }],
  ["POST", "/api/internal/buffer/process", {}, {}],
  ["POST", "/api/internal/buffer/process", {}, { authorization: "Bearer mal", "x-internal-secret": "mal" }],
];
for (const [method, path, body, headers] of PUERTAS) {
  const r = await web(null, method, path, body, headers);
  anotar(r.status === 401 || r.status === 403 ? "bien" : "falla", `sin secreto: ${method} ${path} ${JSON.stringify(headers)}`, `${r.status}: ${r.text}`);
}

const entrante = {
  id: "evt-falso",
  type: "whatsapp.inbound_message.received",
  whatsappInboundMessage: {
    id: "wamid.falso",
    wabaId: "x",
    from: "+5490000099",
    customerProfile: { name: "ATACANTE" },
    to: "+5490000000",
    type: "text",
    text: { body: "mensaje falso" },
  },
};
for (const [nombre, headers] of [
  ["sin firma", {}],
  ["firma falsa", { "ycloud-signature": "t=1700000000,s=deadbeef" }],
]) {
  const r = await web(null, "POST", "/api/webhooks/ycloud", entrante, headers);
  const creado = await service("GET", "/rest/v1/contacts?phone=eq.%2B5490000099&select=id");
  anotar(creado.json?.length ? "falla" : "bien", `webhook YCloud ${nombre}`, `${r.status}: ${r.text}`);
}
const hl = await web(null, "POST", "/api/webhooks/highlevel", { type: "ContactUpdate", locationId: "x", id: "y" }, {});
anotar(hl.status >= 200 && hl.status < 300 ? "revisar" : "bien", "webhook HighLevel sin firma", `${hl.status}: ${hl.text}`);

// ---------- Base directa, como el navegador puede hacerlo ----------
const tablas = Object.keys((await (await fetch(`${lab.url}/rest/v1/`, { headers: { apikey: lab.service, authorization: `Bearer ${lab.service}` } })).json()).paths ?? {})
  .filter((p) => p !== "/" && !p.startsWith("/rpc/"))
  .map((p) => p.slice(1));
const rpcs = Object.keys((await (await fetch(`${lab.url}/rest/v1/`, { headers: { apikey: lab.service, authorization: `Bearer ${lab.service}` } })).json()).paths ?? {})
  .filter((p) => p.startsWith("/rpc/"));

const tokenB = actors.bAdmin.session.access_token;
const tokenV = actors.aViewer.session.access_token;

for (const tabla of tablas) {
  for (const [nombre, token] of [["anónimo", null], ["admin de otro cliente", tokenB]]) {
    const r = await rest(token, "GET", `/rest/v1/${tabla}?select=*&limit=200`);
    const rows = Array.isArray(r.json) ? r.json : [];
    const ajenas = nombre === "anónimo"
      ? rows
      : rows.filter((f) => f.workspace_id === a.id || (tabla === "workspaces" && f.id === a.id) || JSON.stringify(f).includes("SECRETO-a"));
    if (ajenas.length) anotar(tabla === "template_library" || tabla === "tools" ? "revisar" : "falla", `${nombre} lee ${tabla}`, `${ajenas.length} filas: ${JSON.stringify(ajenas[0])}`);
    else anotar("bien", `${nombre} lee ${tabla}`);
  }
}
for (const fn of rpcs) {
  const r = await rest(null, "POST", `/rest/v1${fn}`, {});
  if (r.status === 404 || r.status === 401 || r.status === 403) anotar("bien", `anónimo ejecuta ${fn}`);
  else anotar("revisar", `anónimo ejecuta ${fn}`, `${r.status}: ${r.text}`);
  const r2 = await rest(tokenB, "POST", `/rest/v1${fn}`, {});
  if (r2.status === 404 || r2.status === 401 || r2.status === 403) anotar("bien", `usuario ejecuta ${fn}`);
  else anotar("revisar", `usuario ejecuta ${fn}`, `${r2.status}: ${r2.text}`);
}

// Correos de otros clientes.
{
  const r = await rest(tokenB, "GET", "/rest/v1/users?select=email,is_super_admin");
  const ajenos = (Array.isArray(r.json) ? r.json : []).filter((u) => u.email?.startsWith("a-"));
  anotar(ajenos.length ? "falla" : "bien", "admin de otro cliente lee correos de usuarios ajenos", `${ajenos.length}: ${JSON.stringify(ajenos[0] ?? null)}`);
}

// Escalar privilegios.
const escalar = [
  ["hacerse súper admin", tokenB, "PATCH", `/rest/v1/users?id=eq.${actors.bAdmin.id}`, { is_super_admin: true }],
  ["sumarse a otro cliente", tokenB, "POST", "/rest/v1/memberships", { workspace_id: a.id, user_id: actors.bAdmin.id, role: "admin" }],
  ["lector se hace admin", tokenV, "PATCH", `/rest/v1/memberships?user_id=eq.${actors.aViewer.id}`, { role: "admin" }],
  ["lector se pasa a otro cliente", tokenV, "PATCH", `/rest/v1/memberships?user_id=eq.${actors.aViewer.id}`, { workspace_id: b.id }],
  ["mover contacto ajeno a mi cliente", tokenB, "PATCH", `/rest/v1/contacts?id=eq.${a.contactId}`, { workspace_id: b.id }],
  ["mover mi contacto a otro cliente", tokenB, "PATCH", `/rest/v1/contacts?id=eq.${b.contactId}`, { workspace_id: a.id }],
  ["mensaje falso en cliente ajeno", tokenB, "POST", "/rest/v1/messages", { workspace_id: a.id, conversation_id: a.conversationId, direction: "in", type: "text", body: "HACKEADO", status: "delivered" }],
  ["borrar contactos ajenos", tokenB, "DELETE", `/rest/v1/contacts?workspace_id=eq.${a.id}`],
  ["lector borra contactos", tokenV, "DELETE", `/rest/v1/contacts?workspace_id=eq.${a.id}`],
  ["lector edita contacto", tokenV, "PATCH", `/rest/v1/contacts?id=eq.${a.contactId}`, { name: "HACKEADO" }],
  ["lector cambia el prompt/negocio", tokenV, "PATCH", `/rest/v1/business_info?workspace_id=eq.${a.id}`, { free_text: "HACKEADO" }],
  ["lector cambia el cliente", tokenV, "PATCH", `/rest/v1/workspaces?id=eq.${a.id}`, { name: "HACKEADO" }],
  ["otro cliente lee credenciales", tokenB, "GET", `/rest/v1/integrations?workspace_id=eq.${a.id}&select=*`],
];
for (const [nombre, token, method, path, body] of escalar) {
  const r = await rest(token, method, path, body);
  const cambio = r.status >= 200 && r.status < 300 && Array.isArray(r.json) && r.json.length > 0;
  anotar(cambio ? "falla" : "bien", `escalar: ${nombre}`, `${r.status}: ${r.text}`);
}

// Credenciales: ¿un lector del mismo cliente las ve?
await service("POST", "/rest/v1/integrations", { workspace_id: a.id, provider: "ycloud", enabled: false, credentials: { ycloud_api_key: "CIFRADO-DE-PRUEBA" }, config: {} });
{
  const r = await rest(tokenV, "GET", `/rest/v1/integrations?workspace_id=eq.${a.id}&select=*`);
  anotar(/CIFRADO-DE-PRUEBA/.test(r.text) ? "falla" : "bien", "lector lee las credenciales de su cliente", `${r.status}: ${r.text}`);
  const api = await web(actors.aViewer, "GET", `/api/workspace/${W}/integrations`);
  anotar(/CIFRADO-DE-PRUEBA/.test(api.text) ? "falla" : "bien", "lector ve credenciales por la API", `${api.status}: ${api.text}`);
  const admin = await web(actors.aAdmin, "GET", `/api/workspace/${W}/integrations`);
  anotar(/CIFRADO-DE-PRUEBA/.test(admin.text) ? "revisar" : "bien", "admin recibe credenciales cifradas por la API", `${admin.status}: ${admin.text}`);
}

// Archivos.
await fetch(`${lab.url}/storage/v1/object/whatsapp-media/${a.id}/${a.conversationId}/secreto.txt`, {
  method: "POST",
  headers: { apikey: lab.service, authorization: `Bearer ${lab.service}`, "content-type": "text/plain" },
  body: "ARCHIVO-SECRETO-a",
});
for (const [nombre, token] of [["anónimo", lab.anon], ["admin de otro cliente", tokenB]]) {
  const objeto = `${a.id}/${a.conversationId}/secreto.txt`;
  const leer = await fetch(`${lab.url}/storage/v1/object/whatsapp-media/${objeto}`, { headers: { apikey: lab.anon, authorization: `Bearer ${token}` } });
  anotar(leer.ok ? "falla" : "bien", `${nombre} baja archivo ajeno`, `${leer.status}`);
  const pub = await fetch(`${lab.url}/storage/v1/object/public/whatsapp-media/${objeto}`);
  anotar(pub.ok ? "falla" : "bien", `${nombre} baja archivo por URL pública`, `${pub.status}`);
  const firmar = await fetch(`${lab.url}/storage/v1/object/sign/whatsapp-media/${objeto}`, { method: "POST", headers: { apikey: lab.anon, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
  anotar(firmar.ok ? "falla" : "bien", `${nombre} firma URL de archivo ajeno`, `${firmar.status}`);
  const subir = await fetch(`${lab.url}/storage/v1/object/whatsapp-media/${a.id}/${a.conversationId}/malo.txt`, { method: "POST", headers: { apikey: lab.anon, authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "x" });
  anotar(subir.ok ? "falla" : "bien", `${nombre} sube archivo a cliente ajeno`, `${subir.status}`);
  const media = await web(token === lab.anon ? null : actors.bAdmin, "POST", "/api/inbox/media-url", { path: objeto, storagePath: objeto, storage_path: objeto });
  anotar(/token=|signedUrl|url"/.test(media.text) ? "falla" : "bien", `${nombre} pide URL firmada a la API`, `${media.status}: ${media.text}`);
}

// Entradas maliciosas.
for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:54321/rest/v1/", "http://[::1]/", "http://2130706433/"]) {
  const r = await web(actors.aManager, "POST", `/api/workspace/${W}/kb`, { title: "ssrf", url, source_type: "url", type: "url" });
  anotar(r.status >= 200 && r.status < 300 ? "revisar" : "bien", `dirección interna en base de conocimiento: ${url}`, `${r.status}: ${r.text}`);
}
{
  const r = await web(actors.aAdmin, "PATCH", `/api/contacts/${a.contactId}`, { name: "ok", workspace_id: b.id, id: b.contactId });
  const estado = await service("GET", `/rest/v1/contacts?id=eq.${a.contactId}&select=workspace_id`);
  anotar(estado.json?.[0]?.workspace_id === a.id ? "bien" : "falla", "campos de más al editar un contacto", `${r.status}: ${r.text}`);
}

// Encabezados.
{
  const res = await fetch(`${BASE}/login`);
  for (const h of ["x-frame-options", "x-content-type-options", "referrer-policy", "content-security-policy", "permissions-policy"]) {
    anotar(res.headers.get(h) ? "bien" : "revisar", `encabezado ${h}`, "falta");
  }
}

// ¿Quedó todo intacto?
const contacto = await service("GET", `/rest/v1/contacts?id=eq.${a.contactId}&select=name,workspace_id`);
const miembros = await service("GET", `/rest/v1/memberships?workspace_id=eq.${a.id}&select=user_id,role`);
const superB = await service("GET", `/rest/v1/users?id=eq.${actors.bAdmin.id}&select=is_super_admin`);
const hack = await service("GET", `/rest/v1/messages?body=eq.HACKEADO&select=id,workspace_id,sender_user_id`);
const estadoFinal = {
  contactoA: contacto.json?.[0],
  miembrosA: miembros.json?.map((m) => m.role),
  bEsSuperAdmin: superB.json?.[0]?.is_super_admin,
  mensajesHackeados: hack.json?.length,
};

writeFileSync(process.argv[3], JSON.stringify({ resumen, estadoFinal, hallazgos }, null, 2));
console.log(JSON.stringify({ resumen, estadoFinal }, null, 2));
for (const h of hallazgos) console.log(`[${h.gravedad}] ${h.prueba}\n    ${h.detalle.replace(/\s+/g, " ").slice(0, 170)}`);
