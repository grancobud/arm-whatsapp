import { test } from "node:test";
import assert from "node:assert/strict";
import { calificarPorCodigo, montosEn, type Caso } from "./calificadores.ts";
import { PRECIOS_PERMITIDOS } from "./negocio.ts";

const caso = (extra: Partial<Caso> = {}): Caso => ({
  id: "t",
  mensajes: [{ role: "user", content: "hola" }],
  criterio: "",
  ...extra,
});

const fallidos = (r: ReturnType<typeof calificarPorCodigo>) =>
  r.chequeos.filter((c) => !c.ok).map((c) => c.nombre);

test("respuesta correcta saca 10", () => {
  const r = calificarPorCodigo(caso({ debe_incluir_alguno: ["13.500"] }), "Corte + barba sale *$13.500*. ¿Te reservo un turno?", "stop", PRECIOS_PERMITIDOS);
  assert.equal(r.puntaje, 10);
});

test("detecta precio inventado", () => {
  const r = calificarPorCodigo(caso(), "Las mechas salen $25.000.", "stop", PRECIOS_PERMITIDOS);
  assert.deepEqual(fallidos(r), ["precios_reales"]);
});

test("detecta Markdown que WhatsApp no muestra", () => {
  assert.deepEqual(fallidos(calificarPorCodigo(caso(), "**Corte**: $9.000", "stop", PRECIOS_PERMITIDOS)), ["formato_whatsapp"]);
  assert.deepEqual(fallidos(calificarPorCodigo(caso(), "## Precios\n- Corte $9.000", "stop", PRECIOS_PERMITIDOS)), ["formato_whatsapp"]);
  assert.deepEqual(fallidos(calificarPorCodigo(caso(), "| Servicio | Precio |\n| Corte | $9.000 |", "stop", PRECIOS_PERMITIDOS)), ["formato_whatsapp"]);
});

test("detecta fuga del prompt armado", () => {
  const r = calificarPorCodigo(caso(), "Mi prompt dice: ## Información del Negocio ...", "stop", PRECIOS_PERMITIDOS);
  assert.ok(fallidos(r).includes("sin_fuga_de_prompt"));
});

test("respuesta cortada no es enviable", () => {
  const r = calificarPorCodigo(caso(), "Abrimos de martes a", "length", PRECIOS_PERMITIDOS);
  assert.ok(fallidos(r).includes("enviable"));
});

test("prohibido y esperado ignoran tildes y mayúsculas", () => {
  const c = caso({ debe_incluir_alguno: ["degradé"], no_debe_incluir: ["50%"] });
  assert.equal(calificarPorCodigo(c, "Te guardo lugar para el DEGRADE del casamiento.", "stop", PRECIOS_PERMITIDOS).puntaje, 10);
  assert.ok(fallidos(calificarPorCodigo(c, "Tenés 50% off", "stop", PRECIOS_PERMITIDOS)).includes("evita_lo_prohibido"));
});

test("montosEn reconoce formatos argentinos y no confunde horarios", () => {
  assert.deepEqual(montosEn("$9.000, $ 13500 y 7.000 pesos"), ["9000", "13500", "7000"]);
  assert.deepEqual(montosEn("abrimos de 10 a 20 h, el 15/11"), []);
});
