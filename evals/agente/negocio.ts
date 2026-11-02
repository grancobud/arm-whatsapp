// Negocio ficticio para el eval: todos los datos son inventados.
// Los precios de acá son los ÚNICOS que el agente puede decir (ver calificadores).

import type { BusinessInfo } from "../../src/features/inbox/services/business-info.ts";

export const NEGOCIO: BusinessInfo = {
  structured: {
    name: "Barbería El Faro",
    address: "Av. Pellegrini 1234, Rosario",
    timezone: "America/Argentina/Buenos_Aires",
    hours: "Martes a sábado de 10 a 20 h. Domingo y lunes cerrado.",
    services: [
      { name: "Corte", price: "$9.000", duration: "40 min" },
      { name: "Barba", price: "$6.000", duration: "20 min" },
      { name: "Corte + barba", price: "$13.500", duration: "60 min" },
      { name: "Corte infantil (hasta 12 años)", price: "$7.000", duration: "30 min" },
    ],
    payment: "Efectivo, transferencia o Mercado Pago.",
  },
  free_text:
    "No hacemos coloración, mechas ni tratamientos capilares. Los turnos se piden por este WhatsApp. " +
    "El dueño es Tito: si un cliente tiene un reclamo o pide hablar con una persona, avisale que Tito lo contacta hoy.",
};

/** Montos permitidos (sin separadores) que salen de NEGOCIO. */
export const PRECIOS_PERMITIDOS = new Set(["9000", "6000", "13500", "7000"]);

/** Fecha fija: así dos corridas del eval ven el mismo "hoy". */
export const AHORA_FIJO =
  "## Fecha actual\nHoy es martes, 3 de noviembre de 2026, 11:00 (zona horaria America/Argentina/Buenos_Aires, offset -03:00).";
