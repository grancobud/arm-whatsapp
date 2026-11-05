// Test sin red de las alertas por mail: qué cuenta como problema, cómo se
// agrupa y que el mail no lleve claves ni HTML de un payload.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, isAlertWorthy, renderEmail, type AlertEvent } from "@/features/alerts/alerts";

const ev = (over: Partial<AlertEvent>): AlertEvent => ({
  workspace_id: "w1",
  type: "batch_dead_letter",
  level: "error",
  payload: {},
  created_at: "2026-11-03T10:00:00Z",
  ...over,
});

test("cuenta como problema: errores y los avisos que necesitan una persona", () => {
  assert.equal(isAlertWorthy(ev({})), true);
  assert.equal(isAlertWorthy(ev({ type: "mcp_server_error", level: "warn" })), true);
  assert.equal(isAlertWorthy(ev({ type: "cost_alert", level: "warn" })), true);
});

test("no avisa lo normal del negocio ni las aprobaciones pendientes", () => {
  assert.equal(isAlertWorthy(ev({ type: "setter_evaluation", level: "warn" })), false); // lead descartado
  assert.equal(isAlertWorthy(ev({ type: "jev_judgment", level: "warn" })), false);
  assert.equal(isAlertWorthy(ev({ type: "tool_call", payload: { requires_confirmation: true } })), false);
  assert.equal(isAlertWorthy(ev({ type: "tool_call", payload: { requires_confirmation: false } })), true);
  assert.equal(isAlertWorthy(ev({ type: "alert_sent", level: "info" })), false);
});

test("agrupa por cliente y tipo, con el detalle del más reciente", () => {
  const rows = buildDigest(
    [
      ev({ payload: { error: "viejo" }, created_at: "2026-11-03T10:00:00Z" }),
      ev({ payload: { error: "nuevo" }, created_at: "2026-11-03T10:05:00Z" }),
      ev({ workspace_id: "w2", type: "mcp_server_error", level: "warn", payload: { server: "stock" } }),
      ev({ type: "jev_judgment", level: "warn" }),
    ],
    { w1: "Perrera", w2: "Barbería" },
  );
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].workspace, rows[0].type, rows[0].count, rows[0].detail], ["Perrera", "batch_dead_letter", 2, "nuevo"]);
  assert.equal(rows[1].detail, "stock");
});

test("el mail no lleva claves ni HTML del payload", () => {
  const rows = buildDigest(
    [ev({ type: "tool_call", payload: { api_key: "sk-secreta", tool_name: "<script>alert(1)</script>" } })],
    { w1: "Perrera" },
  );
  const { subject, html } = renderEmail(rows, "https://arm.example");
  assert.match(subject, /1 problema en Perrera/);
  assert.doesNotMatch(html, /sk-secreta/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Herramienta que falló/);
});

test("si la búsqueda de conocimiento falla, avisa", () => {
  assert.equal(
    isAlertWorthy({ workspace_id: "w", type: "kb_search_failed", level: "warn", payload: null, created_at: "" }),
    true,
  );
});
