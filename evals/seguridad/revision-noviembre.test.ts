// Los errores que encontró la revisión del 10/11/2026, cada uno con su caso.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contactNameUpdate, nextUnread, reopensOnInbound } from "@/features/inbox/services/normalizer";
import { canTransition } from "@/features/inbox/services/state-machine";
import { teamChangeError, workspaceOfStoragePath } from "@/lib/auth/team-rules";
import { isCronAuthorized } from "@/lib/auth/cron-auth";
import { sameEmail } from "@/lib/auth/provision-user";
import { isStaleSending } from "@/features/arm/services/follow-ups";

test("el nombre de perfil de WhatsApp no pisa el que dio el cliente", () => {
  assert.deepEqual(contactNameUpdate("Juan Pérez", "🔥JP🔥"), {});
  assert.deepEqual(contactNameUpdate("Juan Pérez", null), {});
  assert.deepEqual(contactNameUpdate(null, "Juan"), { name: "Juan" });
  assert.deepEqual(contactNameUpdate("  ", " Juan "), { name: "Juan" });
  assert.deepEqual(contactNameUpdate(null, null), {});
});

test("el contador de no leídos suma con cada mensaje y no se dispara", () => {
  assert.equal(nextUnread(0), 1);
  assert.equal(nextUnread(null), 1);
  assert.equal(nextUnread(undefined), 1);
  assert.equal(nextUnread(4), 5);
  assert.equal(nextUnread(-3), 1);
  assert.equal(nextUnread(999), 999);
});

test("una charla cerrada se reabre cuando el cliente vuelve, salvo que esté de baja", () => {
  assert.equal(reopensOnInbound("closed", true), true);
  assert.equal(reopensOnInbound("closed", false), false);
  assert.equal(reopensOnInbound("paused", true), false);
  assert.equal(reopensOnInbound("human_active", true), false);
  assert.equal(canTransition("closed", "ai_active"), true);
  assert.equal(canTransition("closed", "human_active"), false);
});

test("un manager no puede darse rol admin ni tocar a un admin o a otro manager", () => {
  const base = { activeAdmins: 2 };
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: "manager", newRole: "admin" }));
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: "agent", newRole: "admin" }));
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: "agent", newRole: "manager" }));
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: "admin", deactivates: true }));
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: "manager", deactivates: true }));
  assert.ok(teamChangeError({ ...base, actorRole: "manager", targetRole: null, newRole: "admin" }));
});

test("un manager sigue manejando agentes y lectores, y un admin todo", () => {
  const base = { activeAdmins: 2 };
  assert.equal(teamChangeError({ ...base, actorRole: "manager", targetRole: "viewer", newRole: "agent" }), null);
  assert.equal(teamChangeError({ ...base, actorRole: "manager", targetRole: "agent", deactivates: true }), null);
  assert.equal(teamChangeError({ ...base, actorRole: "manager", targetRole: null, newRole: "agent" }), null);
  assert.equal(teamChangeError({ ...base, actorRole: "admin", targetRole: "manager", newRole: "admin" }), null);
  assert.equal(teamChangeError({ ...base, actorRole: "admin", targetRole: "admin", newRole: "manager" }), null);
});

test("el negocio no queda sin admin activo", () => {
  assert.ok(teamChangeError({ actorRole: "admin", targetRole: "admin", deactivates: true, activeAdmins: 1 }));
  assert.ok(teamChangeError({ actorRole: "admin", targetRole: "admin", newRole: "agent", activeAdmins: 1 }));
  assert.equal(teamChangeError({ actorRole: "admin", targetRole: "admin", newRole: "admin", activeAdmins: 1 }), null);
  // Un admin ya desactivado no cuenta entre los activos: cambiarlo no deja al negocio sin nadie.
  assert.equal(teamChangeError({ actorRole: "admin", targetRole: "admin", targetIsActive: false, newRole: "agent", activeAdmins: 1 }), null);
});

test("un archivo solo se firma para el negocio que figura en su ruta", () => {
  const ws = "2cc4801f-0111-4ff4-aba0-090e16fb6001";
  assert.equal(workspaceOfStoragePath(`${ws}/conv/123-foto.jpg`), ws);
  assert.equal(workspaceOfStoragePath("otra-cosa/conv/foto.jpg"), null);
  assert.equal(workspaceOfStoragePath(`${ws}/../otro/foto.jpg`), null);
  assert.equal(workspaceOfStoragePath(`/${ws}/foto.jpg`), null);
  assert.equal(workspaceOfStoragePath(""), null);
});

test("sin secreto configurado el cron no acepta a nadie", () => {
  assert.equal(isCronAuthorized("Bearer undefined", undefined), false);
  assert.equal(isCronAuthorized("Bearer ", ""), false);
  assert.equal(isCronAuthorized(null, "abc"), false);
  assert.equal(isCronAuthorized("Bearer abd", "abc"), false);
  assert.equal(isCronAuthorized("Bearer abc", "abc"), true);
});

test("el correo de una cuenta se compara sin mayúsculas", () => {
  assert.equal(sameEmail("Nico@Mail.com ", "nico@mail.com"), true);
  assert.equal(sameEmail(null, "nico@mail.com"), false);
});

test("un seguimiento tomado hace rato y sin cerrar se libera; uno recién tomado, no", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  assert.equal(isStaleSending({ done_at: "2026-11-10T14:40:00Z", due_at: "2026-11-09T02:00:00Z" }, now), true);
  // Vencido de noche y tomado recién a la mañana: sigue en curso.
  assert.equal(isStaleSending({ done_at: "2026-11-10T14:58:00Z", due_at: "2026-11-09T02:00:00Z" }, now), false);
  // Los que quedaron trabados antes de guardar la hora.
  assert.equal(isStaleSending({ done_at: null, due_at: "2026-11-08T14:00:00Z" }, now), true);
  assert.equal(isStaleSending({ done_at: null, due_at: "2026-11-10T14:00:00Z" }, now), false);
});
