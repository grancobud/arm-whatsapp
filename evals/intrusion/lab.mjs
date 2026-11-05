// Laboratorio de la prueba de intrusión: dos clientes inventados y un usuario por
// rol, solo en el Supabase local. Se niega a correr contra otra dirección.
//   node evals/intrusion/lab.mjs <archivo-de-estado.json>

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execSync("npx --yes supabase@latest status -o json", { encoding: "utf8" }));
const url = status.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error(`Solo en local, no en ${url}`);

const anon = status.ANON_KEY;
const service = status.SERVICE_ROLE_KEY;
const db = createClient(url, service, { auth: { persistSession: false } });
const PASSWORD = "laboratorio-local-1234";

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function actor(email, superAdmin = false) {
  const created = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  const id = created.data?.user?.id ?? (await db.auth.admin.listUsers()).data.users.find((u) => u.email === email)?.id;
  if (!id) throw new Error(`usuario ${email}: ${created.error?.message}`);
  await must(db.from("users").upsert({ id, email, full_name: email.split("@")[0], is_super_admin: superAdmin }), "users");
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const login = await must(client.auth.signInWithPassword({ email, password: PASSWORD }), "login");
  return { id, email, session: login.session };
}

async function workspace(slug, members) {
  const w = await must(db.from("workspaces").upsert({ name: `Cliente ${slug}`, slug }, { onConflict: "slug" }).select().single(), "workspace");
  for (const [user, role] of members) {
    await must(db.from("memberships").upsert({ workspace_id: w.id, user_id: user.id, role }, { onConflict: "workspace_id,user_id" }), "membership");
  }
  const contact = await must(
    db.from("contacts").upsert(
      { workspace_id: w.id, phone: `+54900000${slug === "a" ? "1" : "2"}`, name: `SECRETO-${slug}`, email: `secreto-${slug}@ejemplo.test`, opt_in: true },
      { onConflict: "workspace_id,phone" },
    ).select().single(),
    "contact",
  );
  const conversation = await must(
    db.from("conversations").upsert(
      { workspace_id: w.id, contact_id: contact.id, channel: "whatsapp", last_message_at: new Date().toISOString(), window_expires_at: new Date(Date.now() + 864e5).toISOString() },
      { onConflict: "workspace_id,contact_id,channel" },
    ).select().single(),
    "conversation",
  );
  await must(db.from("messages").insert({ workspace_id: w.id, conversation_id: conversation.id, direction: "in", type: "text", body: `MENSAJE-SECRETO-${slug}`, status: "delivered" }), "message");
  await must(db.from("contact_claims").insert({ workspace_id: w.id, contact_id: contact.id, kind: "fact", text: `DATO-SECRETO-${slug}`, author: "agent", status: "active" }), "claim");
  return { id: w.id, contactId: contact.id, conversationId: conversation.id };
}

const aAdmin = await actor("a-admin@lab.test");
const aManager = await actor("a-manager@lab.test");
const aAgent = await actor("a-agent@lab.test");
const aViewer = await actor("a-viewer@lab.test");
const bAdmin = await actor("b-admin@lab.test");

const a = await workspace("a", [[aAdmin, "admin"], [aManager, "manager"], [aAgent, "agent"], [aViewer, "viewer"]]);
const b = await workspace("b", [[bAdmin, "admin"]]);

writeFileSync(
  process.argv[2],
  JSON.stringify({ url, anon, service, a, b, actors: { aAdmin, aManager, aAgent, aViewer, bAdmin } }, null, 2),
);
console.log("laboratorio listo: 2 clientes, 5 usuarios");
