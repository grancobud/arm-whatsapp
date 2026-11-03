// Test sin red de la retención de herramientas sensibles: la acción nunca se
// ejecuta sin aprobación, y si la propuesta no se pudo guardar (falla de la
// base, o el chat de prueba de agentes, que no tiene conversación) el agente no
// recibe "una persona lo va a confirmar", porque nadie la va a ver en Revisión.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registry, pendingApprovalResult } from "@/features/tools/registry";
import type { Tool } from "@/features/tools/core/tool";

test("con propuesta guardada: pendiente, con su id", () => {
  const r = pendingApprovalResult("p-1");
  const out = r.output as { pending_approval: boolean; proposal_id: string; message: string };
  assert.equal(out.pending_approval, true);
  assert.equal(out.proposal_id, "p-1");
  assert.equal(r.requiresConfirmation, true);
  assert.match(out.message, /va a confirmar/);
});

test("sin propuesta guardada: no promete confirmación", () => {
  const r = pendingApprovalResult(null);
  const out = r.output as { pending_approval: boolean; message: string };
  assert.equal(out.pending_approval, false);
  assert.equal(r.requiresConfirmation, true); // igual quedó retenida, no corrió
  assert.match(out.message, /no le prometas/i);
});

test("runTool: sin base disponible no ejecuta la sensible y avisa que no quedó pendiente", async () => {
  // Sin NEXT_PUBLIC_SUPABASE_URL, guardar la propuesta falla: es el caso a cubrir.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  let ejecutada = false;
  const reservar: Tool = {
    name: "mcp_tienda__reservar_producto",
    description: "Reserva",
    sensitivity: "sensitive",
    schema: z.object({ producto: z.string() }),
    enabledFor: () => true,
    run: async () => {
      ejecutada = true;
      return { ok: true, output: "reservado" };
    },
  };
  const r = await registry.runTool(reservar, { producto: "cera" }, { workspaceId: "w", conversationId: "", contactId: "" });
  assert.equal(ejecutada, false);
  assert.equal((r.output as { pending_approval: boolean }).pending_approval, false);
});
