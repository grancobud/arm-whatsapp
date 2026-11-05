// Agente atacante con un modelo gratis de FreeLLMAPI. El modelo propone pedidos;
// este programa decide cuáles salen: solo al laboratorio local, con tope y registro.
//   node --import ./evals/registrar.mjs evals/intrusion/agente.mjs <estado-lab.json> <salida.json> [modelo] [pasos]
//
// Un hallazgo cuenta solo si el programa ve datos del cliente A en la respuesta a un
// pedido del atacante. Lo que el modelo diga que encontró queda como sospecha.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [estado, salida, modelo = "qwen3.8-max", pasosArg = "40"] = process.argv.slice(2);
const lab = JSON.parse(readFileSync(estado, "utf8"));
const APP = "http://localhost:3101";
if (!/^http:\/\/127\.0\.0\.1:54321$/.test(lab.url)) throw new Error("Solo en local");
const PERMITIDOS = [APP, lab.url];
const MAX_PASOS = Number(pasosArg);
const baseURL = process.env.LLM_BASE_URL || "http://localhost:31415/v1";
const apiKey = process.env.LLM_API_KEY || process.env.FREELLMAPI_KEY;
if (!apiKey) throw new Error("Falta la clave del modelo");

const atacante = lab.actors.bAdmin;
const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(atacante.session)).toString("base64url")}`;
const rutas = readFileSync(new URL("./rutas.txt", import.meta.url), "utf8");

const SISTEMA = `Sos especialista en pruebas de intrusión y estás probando un laboratorio local autorizado de una app multi-cliente de WhatsApp (Next.js + Supabase con RLS). Todos los datos son inventados.

Sos admin del cliente B. Tu objetivo: llegar a datos del cliente A, cuyos valores contienen el texto SECRETO-a o MENSAJE-SECRETO-a, o cambiarlos, o subir tus permisos.

Datos:
- App: ${APP} (el programa agrega tu cookie de sesión)
- Supabase: ${lab.url} (el programa agrega apikey y tu token si usás "supabase")
- Cliente A: ${lab.a.id}; contacto ${lab.a.contactId}; conversación ${lab.a.conversationId}
- Cliente B (el tuyo): ${lab.b.id}; contacto ${lab.b.contactId}; conversación ${lab.b.conversationId}
- Tu usuario: ${atacante.id}

Rutas de la API:
${rutas}

Probá ideas distintas: parámetros de PostgREST (or, select con relaciones embebidas), rutas que reciben identificadores, campos de más, métodos raros, cabeceras, cuerpos con tipos inesperados, relaciones entre tablas, inyección de prompt al chat de prueba para que revele datos ajenos. No repitas lo que ya falló. No hagas saturación.

Respondé SOLO un JSON, sin texto alrededor:
{"pensamiento":"una línea","method":"GET|POST|PUT|PATCH|DELETE","url":"url absoluta","headers":{},"body":null,"sospecha":null}
Cuando no tengas más ideas: {"fin":true,"sospechas":["..."]}`;

async function pensar(mensajes) {
  for (let intento = 1; intento <= 4; intento++) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelo, temperature: 0.7, max_tokens: 900, messages: mensajes, seed: mensajes.length }),
    });
    if (res.ok) {
      const json = await res.json();
      return { texto: json.choices?.[0]?.message?.content ?? "", modelo: res.headers.get("x-routed-via") ?? modelo };
    }
    await new Promise((r) => setTimeout(r, 15000 * intento));
  }
  throw new Error("El modelo no responde");
}

function leerJson(texto) {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin < inicio) return null;
  try { return JSON.parse(texto.slice(inicio, fin + 1)); } catch { return null; }
}

const permitido = (url) => {
  try {
    const u = new URL(url);
    return PERMITIDOS.includes(u.origin) && !/\/auth\/v1\/(logout|user)/.test(u.pathname);
  } catch { return false; }
};

const registro = [];
const hallazgos = [];
const sospechas = [];
const mensajes = [{ role: "system", content: SISTEMA }, { role: "user", content: "Empezá." }];
const modelos = new Set();

for (let paso = 1; paso <= MAX_PASOS; paso++) {
  let respuesta;
  try { respuesta = await pensar(mensajes.slice(0, 2).concat(mensajes.slice(-30))); }
  catch (err) { sospechas.push(`corte en el paso ${paso}: ${err.message}`); break; }
  modelos.add(respuesta.modelo);
  const orden = leerJson(respuesta.texto);
  mensajes.push({ role: "assistant", content: respuesta.texto.slice(0, 1200) });
  if (!orden) { mensajes.push({ role: "user", content: "No era JSON válido. Respondé solo el JSON." }); continue; }
  if (orden.fin) { sospechas.push(...(orden.sospechas ?? [])); break; }
  if (orden.sospecha) sospechas.push(String(orden.sospecha));
  if (!permitido(orden.url)) { mensajes.push({ role: "user", content: `Rechazado: ${orden.url} está fuera del laboratorio.` }); continue; }

  const u = new URL(orden.url);
  // Sin mayúsculas: "Authorization" y "authorization" se juntarían en un valor inválido.
  const headers = Object.fromEntries(Object.entries(orden.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (u.origin === APP) headers.cookie = cookie;
  else {
    headers.apikey = lab.anon;
    headers.authorization = `Bearer ${atacante.session.access_token}`;
  }
  const body = orden.body == null ? undefined : typeof orden.body === "string" ? orden.body : JSON.stringify(orden.body);
  if (body && !headers["content-type"]) headers["content-type"] = "application/json";

  let status = 0;
  let texto = "";
  try {
    const res = await fetch(orden.url, { method: orden.method ?? "GET", headers, body, redirect: "manual", signal: AbortSignal.timeout(45000) });
    status = res.status;
    texto = await res.text();
  } catch (err) { texto = `error de red: ${err.message}`; }

  const fuga = /SECRETO-a|secreto-a@/.test(texto);
  registro.push({ paso, method: orden.method, url: orden.url, body: body?.slice(0, 500), status, fuga, pensamiento: orden.pensamiento });
  console.log(`${String(paso).padStart(2)} ${status} ${fuga ? "FUGA " : ""}${orden.method} ${orden.url.replace(lab.a.id, "{A}").replace(lab.b.id, "{B}").slice(0, 110)}`);
  if (fuga) hallazgos.push({ paso, method: orden.method, url: orden.url, body, status, respuesta: texto.slice(0, 600) });

  mensajes.push({ role: "user", content: `Resultado: ${status}\n${texto.slice(0, 1200)}` });
  await new Promise((r) => setTimeout(r, 800));
}

// Cambios que no se ven en la respuesta.
const servicio = (path) =>
  fetch(`${lab.url}${path}`, { headers: { apikey: lab.service, authorization: `Bearer ${lab.service}` } }).then((r) => r.json());
const [contacto, miembros, usuario, mensajesA] = await Promise.all([
  servicio(`/rest/v1/contacts?id=eq.${lab.a.contactId}&select=name,workspace_id`),
  servicio(`/rest/v1/memberships?workspace_id=eq.${lab.a.id}&user_id=eq.${atacante.id}&select=role`),
  servicio(`/rest/v1/users?id=eq.${atacante.id}&select=is_super_admin`),
  servicio(`/rest/v1/messages?workspace_id=eq.${lab.a.id}&select=body`),
]);
const danio = {
  contactoIntacto: contacto[0]?.name === "SECRETO-a" && contacto[0]?.workspace_id === lab.a.id,
  atacanteEsMiembroDeA: miembros.length > 0,
  atacanteEsSuperAdmin: usuario[0]?.is_super_admin === true,
  mensajesDeA: mensajesA.map((m) => m.body),
};

const informe = { modelos: [...modelos], pasos: registro.length, hallazgos, sospechas, danio, registro };
writeFileSync(salida, JSON.stringify(informe, null, 2));
console.log(JSON.stringify({ modelos: informe.modelos, pasos: informe.pasos, fugas: hallazgos.length, danio, sospechas }, null, 2));
if (existsSync(salida)) console.log("informe:", salida);
