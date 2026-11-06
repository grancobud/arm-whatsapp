// Volumen en el laboratorio: mide cuánto aguanta el código con muchos datos y una ráfaga de
// mensajes. Corre contra el Supabase local, con YCloud y el modelo falsos. No gasta cupo.
//
//   1. npx supabase start
//   2. node evals/recorrido/servidor.mjs --compilado   (o el preview "arm-volumen"; con `next dev` no vale)
//   3. npm run eval:volumen
//
// Sirve para encontrar consultas lentas y cuellos de botella. No dice cuántos clientes aguanta
// producción: es otra máquina, sin la latencia ni los límites de Vercel y Supabase.

import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const lab = JSON.parse(readFileSync(new URL("../recorrido/resultados/lab.json", import.meta.url), "utf8"));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(lab.url)) throw new Error("Solo en local");
process.env.ENCRYPTION_KEY = lab.encriptar;
process.env.ENCRYPTION_KEY_VERSION = "v1";
const { encryptCredentials } = await import("../../src/shared/lib/integration-secrets.ts");

const APP = "http://localhost:3101";
const CONTENEDOR = "supabase_db_arm-whatsapp";
const SECRETO = "secreto-del-webhook";
const CONTACTOS = Number(process.env.VOL_CONTACTOS ?? 5000);
const MENSAJES_POR_CHARLA = Number(process.env.VOL_MENSAJES ?? 40);
const CHARLA_LARGA = Number(process.env.VOL_LARGA ?? 5000);
const EVENTOS = Number(process.env.VOL_EVENTOS ?? 50000);
const RAFAGA_CLIENTES = Number(process.env.VOL_CLIENTES ?? 100);
const RAFAGA_POR_CLIENTE = Number(process.env.VOL_POR_CLIENTE ?? 3);
const RAFAGA_A_LA_VEZ = Number(process.env.VOL_A_LA_VEZ ?? 30);
const REPETICIONES = 6;

const db = createClient(lab.url, lab.service, { auth: { persistSession: false } });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const percentil = (v, p) => {
  const o = [...v].sort((a, b) => a - b);
  return o.length ? Math.round(o[Math.min(o.length - 1, Math.floor(o.length * p))]) : null;
};
const sql = (consulta) =>
  execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: consulta,
    encoding: "utf8",
    maxBuffer: 50_000_000,
  });

async function must(promesa, etiqueta) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${etiqueta}: ${error.message}`);
  return data;
}

// La app compilada tarda en levantar.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${APP}/login`)).ok) break;
  } catch {}
  if (i > 100) throw new Error("La app no levantó en " + APP);
  await dormir(3000);
}

const resultado = { fecha: new Date().toISOString(), datos: { CONTACTOS, MENSAJES_POR_CHARLA, CHARLA_LARGA, EVENTOS } };

// ── Datos ────────────────────────────────────────────────────────────────────
async function crearWorkspace(slug, nombre) {
  sql(`delete from public.workspaces where slug = '${slug}';`);
  return must(db.from("workspaces").insert({ name: nombre, slug }).select().single(), "workspace");
}

const SOLO_RAFAGA = !!process.env.VOL_SOLO_RAFAGA;
if (!SOLO_RAFAGA) {
const grande = await crearWorkspace("vol-grande", "Volumen grande");
const vacio = await crearWorkspace("vol-vacio", "Volumen vacío");

console.log(`Cargando ${CONTACTOS} clientes, ${CONTACTOS * MENSAJES_POR_CHARLA + CHARLA_LARGA} mensajes y ${EVENTOS} eventos...`);
const inicioCarga = Date.now();
sql(`
set session_replication_role = replica;
insert into public.contacts (workspace_id, phone, name, opt_in)
  select '${grande.id}', '+54911' || lpad(i::text, 8, '0'), 'Cliente ' || i, true
  from generate_series(1, ${CONTACTOS}) i;
insert into public.conversations (workspace_id, contact_id, last_message_at, created_at)
  select workspace_id, id, now() - random() * interval '90 days', now() - interval '90 days'
  from public.contacts where workspace_id = '${grande.id}';
insert into public.messages (workspace_id, conversation_id, direction, body, wamid, created_at)
  select c.workspace_id, c.id, (case when i % 2 = 0 then 'in' else 'out' end)::message_direction,
         'Mensaje de prueba número ' || i, 'vol.' || c.id || '.' || i, now() - random() * interval '90 days'
  from public.conversations c, generate_series(1, ${MENSAJES_POR_CHARLA}) i
  where c.workspace_id = '${grande.id}';
insert into public.messages (workspace_id, conversation_id, direction, body, wamid, created_at)
  select c.workspace_id, c.id, (case when i % 2 = 0 then 'in' else 'out' end)::message_direction,
         'Mensaje largo ' || i, 'vol.larga.' || i, now() - (i || ' minutes')::interval
  from (select * from public.conversations where workspace_id = '${grande.id}' order by id limit 1) c,
       generate_series(1, ${CHARLA_LARGA}) i;
insert into public.events (workspace_id, type, level, payload, created_at)
  select '${grande.id}', (array['turn_completed','llm_failover','agent_test_chat'])[1 + i % 3], 'info',
         jsonb_build_object('total_ms', 1000 + i % 5000), now() - random() * interval '30 days'
  from generate_series(1, ${EVENTOS}) i;
set session_replication_role = origin;
analyze public.contacts; analyze public.conversations; analyze public.messages; analyze public.events;
`);
resultado.cargaSegundos = Math.round((Date.now() - inicioCarga) / 1000);
const charlaLarga = sql(`select id from public.conversations where workspace_id = '${grande.id}' order by id limit 1;`).trim();

// ── Pantallas con sesión ─────────────────────────────────────────────────────
const correo = "volumen@lab.test";
const clave = randomBytes(24).toString("base64url"); // Se genera en cada corrida y no se guarda.
const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 });
const existente = lista?.users?.find((u) => u.email === correo);
const usuario = existente
  ? (await db.auth.admin.updateUserById(existente.id, { password: clave })).data.user
  : (await db.auth.admin.createUser({ email: correo, password: clave, email_confirm: true })).data.user;
await must(db.from("users").upsert({ id: usuario.id, email: correo, full_name: "Volumen" }, { onConflict: "id" }), "usuario");
for (const w of [grande, vacio]) {
  await must(db.from("memberships").upsert({ workspace_id: w.id, user_id: usuario.id, role: "admin", is_active: true }, { onConflict: "workspace_id,user_id" }), "miembro");
}

const anon = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", shell: true })).ANON_KEY;
const galletas = new Map();
const cliente = createServerClient(lab.url, anon, {
  cookies: {
    getAll: () => [...galletas].map(([name, value]) => ({ name, value })),
    setAll: (lista) => lista.forEach(({ name, value }) => galletas.set(name, value)),
  },
});
await must(cliente.auth.signInWithPassword({ email: correo, password: clave }), "sesión");
const cabeceraGalletas = (ws) =>
  [...galletas].map(([n, v]) => `${n}=${v}`).concat(`active_workspace_id=${ws}`).join("; ");

async function medirPantalla(ruta, ws) {
  const tiempos = [];
  let estado = null;
  let kb = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    const t = performance.now();
    const res = await fetch(`${APP}${ruta}`, { headers: { cookie: cabeceraGalletas(ws) }, redirect: "manual" });
    const cuerpo = await res.text();
    if (i > 0) tiempos.push(performance.now() - t); // La primera calienta.
    estado = res.status;
    kb = Math.round(cuerpo.length / 1024);
  }
  return { estado, p50: percentil(tiempos, 0.5), max: Math.round(Math.max(...tiempos)), kb };
}

console.log("\n=== Pantallas (ms de la respuesta completa) ===");
console.log("ruta | vacío p50 | grande p50 | grande máx | KB | estado");
resultado.pantallas = {};
for (const [ruta, soloGrande] of [
  ["/inbox"], ["/dashboard"], ["/revision"], ["/campanas"], ["/settings"],
  [`/inbox/${charlaLarga}`, true],
]) {
  const v = soloGrande ? null : await medirPantalla(ruta, vacio.id);
  const g = await medirPantalla(ruta, grande.id);
  const nombre = soloGrande ? "/inbox/[charla con 5.000+ mensajes]" : ruta;
  resultado.pantallas[nombre] = { vacio: v, grande: g };
  console.log(`${nombre} | ${v?.p50 ?? "-"} | ${g.p50} | ${g.max} | ${g.kb} | ${g.estado}${g.estado !== 200 ? " NO VALE" : ""}`);
}

// ── Consultas ────────────────────────────────────────────────────────────────
function explicar(nombre, consulta) {
  const plan = JSON.parse(sql(`explain (analyze, format json) ${consulta};`))[0];
  const texto = JSON.stringify(plan.Plan);
  const secuencial = [...texto.matchAll(/"Node Type":"Seq Scan"[^}]*?"Relation Name":"(\w+)"/g)].map((m) => m[1]);
  return { nombre, ms: Math.round(plan["Execution Time"] * 10) / 10, secuencial };
}
console.log("\n=== Consultas ===");
resultado.consultas = [
  explicar("bandeja: últimas 50 charlas", `select * from public.conversations where workspace_id='${grande.id}' order by last_message_at desc nulls last limit 50`),
  explicar("charla: últimos 50 mensajes", `select * from public.messages where conversation_id='${charlaLarga}' order by created_at desc limit 50`),
  explicar("charla: todos los mensajes", `select * from public.messages where conversation_id='${charlaLarga}' order by created_at`),
  explicar("mensajes de 30 días por dirección", `select direction, count(*) from public.messages where workspace_id='${grande.id}' and created_at > now() - interval '30 days' group by 1`),
  explicar("eventos de 30 días por tipo", `select type, count(*) from public.events where workspace_id='${grande.id}' and created_at > now() - interval '30 days' group by 1`),
  explicar("cliente por teléfono", `select * from public.contacts where workspace_id='${grande.id}' and phone='+5491100002500'`),
];
for (const c of resultado.consultas) console.log(`${c.nombre}: ${c.ms} ms${c.secuencial.length ? ` · recorre toda la tabla: ${c.secuencial.join(", ")}` : ""}`);

}

// ── Ráfaga ───────────────────────────────────────────────────────────────────
const TEXTO = "Respuesta de prueba del modelo.";
writeFileSync(lab.control, JSON.stringify({ respaldo: "ok", texto: TEXTO }));
const rafaga = await crearWorkspace("vol-rafaga", "Volumen ráfaga");
const telefono = `+5492${Date.now() % 1_000_000_000}`;
await must(db.from("integrations").insert({
  workspace_id: rafaga.id, provider: "ycloud", enabled: true,
  credentials: await encryptCredentials({ ycloud_api_key: "clave-falsa", webhook_signing_secret: SECRETO }, rafaga.id, "ycloud"),
  config: { phone_number: telefono, buffer_silence_seconds: 3 },
}), "integración");

const prefijo = Date.now() % 100000;
const envios = [];
for (let c = 0; c < RAFAGA_CLIENTES; c++) {
  for (let m = 0; m < RAFAGA_POR_CLIENTE; m++) envios.push({ de: `+549${prefijo}${String(c).padStart(5, "0")}`, texto: `Consulta ${m}` });
}
async function mandar({ de, texto }) {
  const cuerpo = JSON.stringify({
    id: `ev-${randomUUID()}`, type: "whatsapp.inbound_message.received", createTime: new Date().toISOString(),
    whatsappInboundMessage: { id: randomUUID(), wamid: `wamid.${randomUUID()}`, from: de, to: telefono, type: "text", customerProfile: { name: "Cliente Lab" }, sendTime: new Date().toISOString(), text: { body: texto } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const t = performance.now();
  try {
    const res = await fetch(`${APP}/api/webhooks/ycloud`, {
      method: "POST",
      headers: { "content-type": "application/json", "YCloud-Signature": `t=${ts},s=${createHmac("sha256", SECRETO).update(`${ts}.${cuerpo}`).digest("hex")}` },
      body: cuerpo,
    });
    await res.text();
    return { estado: res.status, ms: performance.now() - t };
  } catch (e) {
    return { estado: e.name, ms: performance.now() - t };
  }
}

console.log(`\n=== Ráfaga: ${envios.length} mensajes de ${RAFAGA_CLIENTES} clientes, ${RAFAGA_A_LA_VEZ} a la vez ===`);
const respuestas = [];
const inicioRafaga = Date.now();
let proximo = 0;
await Promise.all(Array.from({ length: RAFAGA_A_LA_VEZ }, async () => {
  while (proximo < envios.length) respuestas.push(await mandar(envios[proximo++]));
}));
const entradaSeg = (Date.now() - inicioRafaga) / 1000;
const estados = {};
for (const r of respuestas) estados[r.estado] = (estados[r.estado] ?? 0) + 1;
const ms = respuestas.map((r) => r.ms);
console.log(`Webhook: p50 ${percentil(ms, 0.5)} ms, p95 ${percentil(ms, 0.95)} ms, máx ${percentil(ms, 1)} ms · ${entradaSeg.toFixed(1)} s en total · estados ${JSON.stringify(estados)}`);

// En producción el cron corre cada minuto: acá, cada 15 s, y se cuenta cuánto tarda en vaciarse.
const pasadas = [];
const cron = setInterval(async () => {
  const t = performance.now();
  try {
    const res = await fetch(`${APP}/api/cron/buffer-flush`, { headers: { Authorization: `Bearer ${lab.cron}` } });
    const j = await res.json().catch(() => ({}));
    pasadas.push({ seg: Math.round((Date.now() - inicioRafaga) / 1000), ms: Math.round(performance.now() - t), estado: res.status, atendidos: j.processed, corta: j.stopped_by });
  } catch (e) {
    pasadas.push({ seg: Math.round((Date.now() - inicioRafaga) / 1000), ms: Math.round(performance.now() - t), error: e.name });
  }
}, 15_000);
async function estadoRafaga() {
  const contar = async (q) => (await q).count ?? 0;
  const entrada = () => db.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", rafaga.id);
  const lotes = () => db.from("message_batches").select("id", { count: "exact", head: true }).eq("workspace_id", rafaga.id);
  return {
    charlas: await contar(db.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", rafaga.id)),
    entrantes: await contar(entrada().eq("direction", "in")),
    respuestas: await contar(entrada().eq("direction", "out").ilike("body", `%${TEXTO}%`)),
    lotesAbiertos: await contar(lotes().not("status", "in", "(processed,cancelled)")),
  };
}
const limite = Date.now() + 6 * 60_000;
let final = await estadoRafaga();
while (Date.now() < limite && (final.lotesAbiertos > 0 || final.respuestas < RAFAGA_CLIENTES)) {
  await dormir(3000);
  final = await estadoRafaga();
}
clearInterval(cron);
const vaciadoSeg = Math.round((Date.now() - inicioRafaga) / 1000);
await dormir(2000);
final = await estadoRafaga();

const { data: porCharla } = await db.from("messages").select("conversation_id").eq("workspace_id", rafaga.id).eq("direction", "out").ilike("body", `%${TEXTO}%`).limit(5000);
const cuenta = {};
for (const m of porCharla ?? []) cuenta[m.conversation_id] = (cuenta[m.conversation_id] ?? 0) + 1;
const repetidas = Object.values(cuenta).filter((n) => n > RAFAGA_POR_CLIENTE).length;
const { data: malos } = await db.from("events").select("type").eq("workspace_id", rafaga.id).in("level", ["warn", "error"]).limit(1000);
const porTipo = {};
for (const e of malos ?? []) porTipo[e.type] = (porTipo[e.type] ?? 0) + 1;

resultado.rafaga = { envios: envios.length, estados, webhook: { p50: percentil(ms, 0.5), p95: percentil(ms, 0.95), max: percentil(ms, 1) }, entradaSeg, vaciadoSeg, ...final, repetidas, eventos: porTipo };
console.log(`Vaciado en ${vaciadoSeg} s · ${JSON.stringify(final)} · charlas con más respuestas que mensajes: ${repetidas} · avisos: ${JSON.stringify(porTipo)}`);

console.log("\n=== Pasadas del cron ===");
for (const p of pasadas) console.log(JSON.stringify(p));
const motivos = {};
for (const p of pasadas) motivos[p.corta ?? p.error ?? p.estado] = (motivos[p.corta ?? p.error ?? p.estado] ?? 0) + 1;
console.log(`Motivos de corte: ${JSON.stringify(motivos)} · atendidos en total: ${pasadas.reduce((a, p) => a + (p.atendidos ?? 0), 0)}`);
resultado.pasadas = pasadas;

const chequeos = [
  ["todos los webhooks devuelven 200", Object.keys(estados).length === 1 && estados[200] === envios.length],
  ["se guardan todos los mensajes, sin perder ni duplicar", final.entrantes === envios.length],
  ["una charla por cliente", final.charlas === RAFAGA_CLIENTES],
  ["todos los clientes reciben respuesta", Object.keys(cuenta).length === RAFAGA_CLIENTES],
  ["ninguna charla recibe respuestas de más", repetidas === 0],
  ["no quedan lotes sin procesar", final.lotesAbiertos === 0],
  ["ninguna charla ocupada frena la cola", !pasadas.some((p, i) => i > 0 && p.atendidos === 0 && p.corta !== "empty")],
];
console.log("\n=== Chequeos ===");
for (const [n, ok] of chequeos) console.log(`${ok ? "✅" : "❌"} ${n}`);
resultado.chequeos = chequeos;
writeFileSync(new URL("../recorrido/resultados/volumen.json", import.meta.url), JSON.stringify(resultado, null, 2));
process.exit(chequeos.every(([, ok]) => ok) ? 0 : 1);
