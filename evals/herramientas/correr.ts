// Eval de herramientas: corre la función REAL de producción (generateWithTools)
// con las herramientas REALES (mismo nombre, descripción y esquema), pero con la
// ejecución simulada: no reserva turnos ni toca HighLevel ni la base.
//
// Uso:  npm run eval:herramientas -- --gen=mistral-medium-3.5 --reps=2 [--casos=id1,id2]

import { generateWithTools } from "../../src/features/inbox/services/openrouter.ts";
import { registry } from "../../src/features/tools/index.ts";
import type { Tool, ToolResult } from "../../src/features/tools/core/tool.ts";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext } from "../../src/features/inbox/services/business-info.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { AHORA_FIJO, NEGOCIO } from "../agente/negocio.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const GEN = args.gen || "mistral-medium-3.5";
const REPS = Number(args.reps || 2);

type Llamada = { nombre: string; args: Record<string, unknown> };
type Simulador = (nombre: string, args: Record<string, unknown>) => ToolResult;

interface Escenario {
  id: string;
  herramientas: string[];
  historial?: { role: "user" | "assistant"; content: string }[];
  mensaje: string;
  simular: Simulador;
  chequear: (llamadas: Llamada[], texto: string) => { nombre: string; ok: boolean; detalle?: string }[];
}

const HORA = /\b([01]?\d|2[0-3])(:[0-5]\d)?\s?(h|hs|horas)\b|\b([01]?\d|2[0-3]):[0-5]\d\b/i;
const nombres = (ll: Llamada[]) => ll.map((l) => l.nombre);

const SLOTS_VIERNES = ["2026-11-06T15:00:00-03:00", "2026-11-06T17:30:00-03:00"];

const ESCENARIOS: Escenario[] = [
  {
    id: "consulta_disponibilidad",
    herramientas: ["check_availability", "schedule_highlevel", "remember_fact"],
    mensaje: "Hola! tenés turno el viernes a la tarde?",
    simular: (n) =>
      n === "check_availability"
        ? { ok: true, output: { slots: SLOTS_VIERNES, count: 2, message: "Hay 2 horarios disponibles." } }
        : { ok: true, output: { ok: true } },
    chequear: (ll, t) => {
      const ca = ll.find((l) => l.nombre === "check_availability");
      return [
        { nombre: "consulta_antes_de_ofrecer", ok: !!ca },
        { nombre: "fecha_correcta", ok: String(ca?.args.date_from ?? "").startsWith("2026-11-06") || String(ca?.args.date_to ?? "").startsWith("2026-11-06"), detalle: `${ca?.args.date_from}→${ca?.args.date_to}` },
        { nombre: "no_reserva_sin_confirmar", ok: !nombres(ll).includes("schedule_highlevel") },
        { nombre: "ofrece_horarios_reales", ok: /15/.test(t) && /17[:.]30/.test(t) },
      ];
    },
  },
  {
    id: "reserva_encadenada",
    herramientas: ["check_availability", "schedule_highlevel", "remember_fact"],
    historial: [
      { role: "user", content: "quiero un corte el viernes" },
      { role: "assistant", content: "¡Dale! ¿A qué hora te queda bien?" },
    ],
    mensaje: "a las 15, a nombre de Juan Pérez. Confirmalo",
    simular: (n, a) =>
      n === "check_availability"
        ? { ok: true, output: { slots: SLOTS_VIERNES, count: 2, message: "Hay 2 horarios disponibles." } }
        : n === "schedule_highlevel"
          ? { ok: true, output: { appointment_id: "apt_123", datetime: a.datetime_iso } }
          : { ok: true, output: { ok: true } },
    chequear: (ll, t) => {
      const sh = ll.filter((l) => l.nombre === "schedule_highlevel");
      return [
        { nombre: "reserva_una_sola_vez", ok: sh.length === 1, detalle: `${sh.length} reservas` },
        { nombre: "hora_correcta", ok: String(sh[0]?.args.datetime_iso ?? "").startsWith("2026-11-06T15:00"), detalle: String(sh[0]?.args.datetime_iso) },
        { nombre: "confirma_por_texto", ok: t.trim().length > 0 && /15/.test(t) },
      ];
    },
  },
  {
    id: "herramienta_falla",
    herramientas: ["check_availability", "schedule_highlevel"],
    mensaje: "tenés lugar el sábado?",
    simular: () => ({ ok: false, output: null, error: "HL API error: 503 Service Unavailable" }),
    chequear: (ll, t) => [
      { nombre: "intenta_consultar", ok: nombres(ll).includes("check_availability") },
      { nombre: "responde_igual", ok: t.trim().length > 0 },
      { nombre: "no_inventa_horarios", ok: !HORA.test(t.replace(/10 a 20|10 y 20|de 10|a 20/gi, "")), detalle: t.match(HORA)?.[0] },
      { nombre: "no_reserva", ok: !nombres(ll).includes("schedule_highlevel") },
      { nombre: "no_afirma_que_hay_lugar", ok: !/^\W*s[ií][,!.]|tenemos lugar|hay lugar|hay turno/i.test(t), detalle: t.slice(0, 60) },
    ],
  },
  {
    id: "accion_sensible",
    herramientas: ["custom_webhook"],
    mensaje: "Pasale mis datos al encargado así me llama hoy, porfa. Es por un tema de un turno de grupo",
    simular: () => ({ ok: true, output: { ok: true } }),
    chequear: (ll, t) => {
      const llamo = nombres(ll).includes("custom_webhook");
      return [
        { nombre: "usa_la_herramienta", ok: llamo },
        { nombre: "no_dice_que_ya_esta", ok: !/(ya (te|lo|quedó|quedaste|est[aá])|listo,? (ya|te registr)|quedaste registrad|te registr[eé])/i.test(t), detalle: t.slice(0, 80) },
        { nombre: "responde_igual", ok: t.trim().length > 0 },
      ];
    },
  },
  {
    id: "guarda_memoria",
    herramientas: ["check_availability", "schedule_highlevel", "remember_fact"],
    mensaje: "Es para el casamiento de mi hermano el 15, quiero un degradé bien prolijo",
    simular: () => ({ ok: true, output: { saved: true } }),
    chequear: (ll, t) => {
      const rf = ll.find((l) => l.nombre === "remember_fact");
      return [
        { nombre: "guarda_el_dato", ok: !!rf },
        { nombre: "cita_al_cliente", ok: /casamiento/i.test(String(rf?.args.quote ?? "")), detalle: String(rf?.args.quote) },
        { nombre: "no_se_lo_cuenta", ok: !/(guard[eé]|anot[eé]|registr[eé]) (en|tu|el dato|que)/i.test(t) },
        { nombre: "responde_igual", ok: t.trim().length > 0 },
      ];
    },
  },
  {
    id: "sin_herramienta",
    herramientas: ["check_availability", "schedule_highlevel", "remember_fact"],
    mensaje: "cuánto sale la barba?",
    simular: () => ({ ok: true, output: { ok: true } }),
    chequear: (ll, t) => [
      { nombre: "no_usa_herramientas_de_turnos", ok: !ll.some((l) => l.nombre !== "remember_fact") },
      { nombre: "precio_correcto", ok: /6[.,]?000/.test(t) },
    ],
  },
];

const casos = args.casos ? ESCENARIOS.filter((e) => args.casos.split(",").includes(e.id)) : ESCENARIOS;

// La cadena de respaldo usa solo el modelo bajo prueba: si falla, se ve.
process.env.OPENROUTER_FALLBACK_MODELS = GEN;

const reales = new Map(registry.list().map((t) => [t.name, t]));
const runOriginal = registry.run.bind(registry);

async function correr(e: Escenario, rep: number) {
  const llamadas: Llamada[] = [];
  const herramientas: Tool[] = e.herramientas.map((n) => {
    const real = reales.get(n)!;
    const simulada: Tool = {
      ...real,
      run: async (a) => e.simular(n, a as Record<string, unknown>),
    };
    registry.register(simulada); // registry.run ejecuta esta versión (valida y aplica la aprobación)
    return simulada;
  });
  // Se anota cada pedido del modelo en la entrada del registro, así cuentan
  // también las sensibles (que quedan pendientes y nunca llegan a run).
  registry.run = (nombre, a, ctx, o) => {
    llamadas.push({ nombre, args: a as Record<string, unknown> });
    return runOriginal(nombre, a, ctx, o);
  };
  const system = buildSystemPrompt({
    nowContext: AHORA_FIJO,
    bizContext: buildBusinessInfoContext(NEGOCIO),
    promptBase: starterPrompt("setter", "Barbería El Faro", "Martín"),
    toolNames: e.herramientas,
  });
  const t0 = Date.now();
  try {
    const r = await generateWithTools({
      systemPrompt: system,
      model: GEN,
      userMessage: e.mensaje,
      history: e.historial,
      workspaceId: "eval",
      availableTools: herramientas,
      toolContext: { workspaceId: "eval", conversationId: "eval", contactId: "eval" },
      temperature: 0.3,
    });
    const pasos = r.toolCallsExecuted;
    const chequeos = e.chequear(llamadas, r.text);
    return { id: e.id, rep, texto: r.text, llamadas, pasos, ms: Date.now() - t0, chequeos };
  } catch (err) {
    return { id: e.id, rep, texto: "", llamadas, pasos: 0, ms: Date.now() - t0, chequeos: [{ nombre: "sin_error", ok: false, detalle: String(err).slice(0, 160) }] };
  } finally {
    for (const n of e.herramientas) registry.register(reales.get(n)!);
  }
}

console.log(`Eval herramientas · modelo ${GEN} · ${casos.length} escenarios × ${REPS} reps`);
const resultados = [];
for (const e of casos) for (let i = 1; i <= REPS; i++) {
  const r = await correr(e, i); // en serie: el registro es compartido
  resultados.push(r);
  const ok = r.chequeos.filter((c) => c.ok).length;
  console.log(`\n${r.id} #${i}  ${ok}/${r.chequeos.length}  (${r.pasos} pasos, ${r.ms} ms)`);
  console.log(`  herramientas: ${r.llamadas.map((l) => `${l.nombre}(${JSON.stringify(l.args)})`).join(" → ") || "ninguna"}`);
  console.log(`  respuesta: ${r.texto.replace(/\n/g, " ").slice(0, 200) || "(vacía)"}`);
  for (const c of r.chequeos.filter((c) => !c.ok)) console.log(`  ❌ ${c.nombre}${c.detalle ? `: ${c.detalle}` : ""}`);
}
const total = resultados.flatMap((r) => r.chequeos);
console.log(`\nTotal: ${total.filter((c) => c.ok).length}/${total.length} chequeos OK`);
