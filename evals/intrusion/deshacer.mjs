// Quién puede deshacer un cambio de la ficha. Solo en el laboratorio local.
//   node evals/intrusion/deshacer.mjs <estado-lab.json>

import { readFileSync } from "node:fs";

const lab = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^http:\/\/127\.0\.0\.1:/.test(lab.url)) throw new Error("Solo en local");
const BASE = "http://localhost:3101";
const cookie = (a) => `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(a.session)).toString("base64url")}`;
const svc = async (method, path, body) => {
  const res = await fetch(`${lab.url}/rest/v1${path}`, {
    method,
    headers: { apikey: lab.service, authorization: `Bearer ${lab.service}`, "content-type": "application/json", prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
};

await svc("PATCH", `/contacts?id=eq.${lab.a.contactId}`, { email: "nuevo@ejemplo.test" });
const [cambio] = await svc("POST", "/contact_changes", {
  workspace_id: lab.a.id,
  contact_id: lab.a.contactId,
  field: "email",
  old_value: "viejo@ejemplo.test",
  new_value: "nuevo@ejemplo.test",
  quote: "mi mail es nuevo@ejemplo.test",
});

// Compila la acción y busca su identificador.
await fetch(`${BASE}/inbox/${lab.a.conversationId}`, { headers: { cookie: cookie(lab.actors.aAdmin) } });
const manifiesto = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const accion = Object.entries(manifiesto.node ?? {}).find(([, v]) => v.exportedName === "revertContactChange")?.[0];
if (!accion) throw new Error("No se encontró la acción");

const correo = async () => (await svc("GET", `/contacts?id=eq.${lab.a.contactId}&select=email`))[0].email;
const intentar = async (nombre, actor) => {
  await fetch(`${BASE}/inbox`, {
    method: "POST",
    headers: { cookie: cookie(actor), "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", "next-action": accion, origin: BASE },
    body: JSON.stringify([cambio.id]),
  });
  console.log(`${nombre}: el correo quedó en ${await correo()}`);
};

await intentar("admin de otro cliente", lab.actors.bAdmin);
await intentar("lector del mismo cliente", lab.actors.aViewer);
await intentar("agente del mismo cliente", lab.actors.aAgent);
