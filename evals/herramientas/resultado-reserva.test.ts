// Test sin red de la inspección del entorno al reservar (lección 66): el agente
// tiene que enterarse de lo que guardó el calendario, no de lo que pidió.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingResult } from "@/features/tools/tools/schedule-highlevel";

const PEDIDO = "2026-11-06T15:00:00-03:00";

test("si el calendario guardó la hora pedida, se confirma esa", () => {
  const r = bookingResult(PEDIDO, { id: "apt_1", startTime: "2026-11-06T18:00:00.000Z" });
  assert.equal(r.ok, true);
  const out = r.output as Record<string, unknown>;
  assert.equal(out.appointment_id, "apt_1");
  assert.equal(out.moved, undefined);
});

test("si la corrió de hora, el agente recibe la hora real y el aviso", () => {
  const r = bookingResult(PEDIDO, { appointment: { id: "apt_2", startTime: "2026-11-06T15:30:00-03:00" } });
  const out = r.output as Record<string, unknown>;
  assert.equal(r.ok, true);
  assert.equal(out.datetime, "2026-11-06T15:30:00-03:00");
  assert.equal(out.moved, true);
  assert.match(String(out.message), /hora real/);
});

test("si el calendario no la guardó, es un error aunque la API respondió 200", () => {
  const r = bookingResult(PEDIDO, { id: "apt_3", appointmentStatus: "cancelled" });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /No le digas/);
});

test("si la respuesta no trae la hora, queda la pedida (como antes)", () => {
  const r = bookingResult(PEDIDO, { id: "apt_4" });
  assert.equal((r.output as Record<string, unknown>).datetime, PEDIDO);
});
