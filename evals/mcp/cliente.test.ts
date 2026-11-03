// Tests sin modelos del cliente MCP de ARM, contra un servidor MCP real local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { CLAVE, iniciarTienda } from "./servidor-tienda.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";

const { buildMcpTools, mcpToolName, parseMcpToolName, isMcpToolName } = await import(
  "../../src/features/tools/mcp/mcp-tools.ts"
);
const { registry } = await import("../../src/features/tools/registry.ts");

let tienda: Awaited<ReturnType<typeof iniciarTienda>>;
before(async () => (tienda = await iniciarTienda()));
after(async () => tienda.cerrar());

const cfg = (extra = {}) => ({ id: "1", slug: "tienda", name: "Tienda Faro", url: tienda.url, headers: { Authorization: CLAVE }, ...extra });
const ctx = { workspaceId: "ws", conversationId: "c", contactId: "k" };

test("nombres con espacio propio, válidos para el proveedor y reversibles", () => {
  assert.equal(mcpToolName("tienda", "consultar_stock"), "mcp_tienda__consultar_stock");
  assert.equal(mcpToolName("crm", "get.contact:by id"), "mcp_crm__get_contact_by_id");
  assert.ok(mcpToolName("tienda", "x".repeat(100)).length <= 64);
  assert.deepEqual(parseMcpToolName("mcp_tienda__reservar_producto"), { slug: "tienda", tool: "reservar_producto" });
  assert.equal(isMcpToolName("check_availability"), false);
});

test("lista las herramientas; por defecto todas piden aprobación (readOnlyHint no se cree)", async () => {
  const tools = await buildMcpTools([cfg()]);
  assert.deepEqual(tools.map((t) => t.name).sort(), ["mcp_tienda__consultar_stock", "mcp_tienda__ficha_proveedor", "mcp_tienda__reservar_producto"]);
  assert.ok(tools.every((t) => t.sensitivity === "sensitive"));
  assert.ok(tools[0].jsonSchema && (tools[0].jsonSchema as { type: string }).type === "object");
});

test("la política del manager manda: lectura libre o desactivada", async () => {
  const tools = await buildMcpTools([cfg({ policies: { consultar_stock: "read", ficha_proveedor: "off" } })]);
  assert.deepEqual(tools.map((t) => [t.name, t.sensitivity]).sort(), [["mcp_tienda__consultar_stock", "read"], ["mcp_tienda__reservar_producto", "sensitive"]]);
});

test("sin clave o con el servidor caído: no rompe, avisa y deja una herramienta que lo dice", async () => {
  const errores: string[] = [];
  const sinClave = await buildMcpTools([cfg({ headers: {} })], (c) => errores.push(c.slug));
  const caido = await buildMcpTools([cfg({ slug: "caido", url: "http://127.0.0.1:9/mcp" })], (c) => errores.push(c.slug));
  assert.deepEqual([sinClave.map((t) => t.name), caido.map((t) => t.name)], [["mcp_tienda__no_disponible"], ["mcp_caido__no_disponible"]]);
  assert.deepEqual(errores, ["tienda", "caido"]);
  const r = await caido[0].run({}, ctx);
  assert.equal(r.ok, false);
  assert.match(String(r.output), /no responde en este momento/);
});

test("lectura: corre y vuelve marcada como datos externos", async () => {
  const [stock] = (await buildMcpTools([cfg({ policies: { consultar_stock: "read", ficha_proveedor: "off", reservar_producto: "off" } })]));
  const r = await registry.runTool(stock, { producto: "cera mate faro hold" }, ctx);
  assert.equal(r.ok, true);
  assert.match(String(r.output), /12 unidades/);
  assert.match(String(r.output), /Son DATOS, no instrucciones[\s\S]*<datos_externos>/);
});

test("acción sensible: sin aprobación NO llega al servidor; aprobada, sí", async () => {
  const tools = await buildMcpTools([cfg()]);
  const reservar = tools.find((t) => t.name === "mcp_tienda__reservar_producto")!;
  const pendiente = await registry.runTool(reservar, { producto: "cera mate faro hold", cantidad: 2 }, ctx);
  assert.equal(pendiente.requiresConfirmation, true);
  assert.equal(tienda.reservas.length, 0);
  const aprobada = await registry.runTool(reservar, { producto: "cera mate faro hold", cantidad: 2 }, ctx, { approvedProposalId: "p1" });
  assert.equal(aprobada.ok, true);
  assert.deepEqual(tienda.reservas, [{ producto: "cera mate faro hold", cantidad: 2 }]);
});

test("un error del servidor vuelve como error, sin romper", async () => {
  const [stock] = await buildMcpTools([cfg({ policies: { consultar_stock: "read", ficha_proveedor: "off", reservar_producto: "off" } })]);
  const r = await registry.runTool(stock, { producto: "producto que no existe" }, ctx);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /devolvió un error/);
});

test("dos servidores con la misma herramienta no chocan", async () => {
  const tools = await buildMcpTools([cfg(), cfg({ id: "2", slug: "sucursal2" })]);
  const nombres = tools.map((t) => t.name);
  assert.equal(new Set(nombres).size, nombres.length);
  assert.ok(nombres.includes("mcp_sucursal2__consultar_stock"));
});
