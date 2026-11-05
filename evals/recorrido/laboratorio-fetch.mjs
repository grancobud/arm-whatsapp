// Laboratorio del recorrido: nada sale a YCloud, HighLevel ni a un modelo.
// Se anota cada pedido y se responde según recorrido-control.json, que cambia cada caso.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const CONTROL = process.env.RECORRIDO_CONTROL;
const LOG = process.env.RECORRIDO_LOG;
const real = globalThis.fetch;
let contador = 0;

const control = () => {
  try {
    return JSON.parse(readFileSync(CONTROL, "utf8"));
  } catch {
    return {};
  }
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const anotar = (entrada) => appendFileSync(LOG, `${JSON.stringify(entrada)}\n`);

function respuestaModelo(pedido, c) {
  const mensajes = pedido.messages ?? [];
  const yaUsoHerramienta = mensajes.some((m) => m.role === "tool");
  const base = {
    id: `lab-${++contador}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "modelo-falso",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  if (c.herramienta && !yaUsoHerramienta) {
    return json({
      ...base,
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: `llamada-${contador}`,
            type: "function",
            function: { name: c.herramienta.name, arguments: JSON.stringify(c.herramienta.args) },
          }],
        },
      }],
    });
  }
  return json({
    ...base,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: c.texto ?? "Hola, ¿en qué te ayudo?" } }],
  });
}

function esperarCorte(signal) {
  return new Promise((_, reject) => {
    const cortar = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) return cortar();
    signal?.addEventListener("abort", cortar, { once: true });
    setTimeout(cortar, 120_000);
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : (input.url ?? String(input));
  const bodyText = typeof init.body === "string" ? init.body : null;
  const c = control();

  if (/api\.ycloud\.com/.test(url)) {
    anotar({ destino: "ycloud", url, method: init.method ?? "GET", body: bodyText });
    if (c.ycloud === "500") return json({ error: { message: "falla simulada" } }, 500);
    return json({ id: `yc-${randomUUID()}`, wamid: `wamid.salida.${randomUUID()}`, status: "accepted" });
  }
  if (/leadconnectorhq\.com|api\.resend\.com/.test(url)) {
    anotar({ destino: "otro", url, method: init.method ?? "GET" });
    return json({ id: "falso" });
  }
  if (/llm\.lab\.test|openrouter\.ai/.test(url)) {
    const esRespaldo = /openrouter\.ai/.test(url);
    // Vuelta con el modelo de verdad: solo si la pide el caso y hay clave en el entorno.
    if (c.modelo === "real" && !esRespaldo && process.env.RECORRIDO_REAL_KEY) {
      const destino = url.replace("http://llm.lab.test/v1", process.env.RECORRIDO_REAL_BASE);
      anotar({ destino: "real", url: destino });
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${process.env.RECORRIDO_REAL_KEY}`);
      return real(destino, { ...init, headers });
    }
    const modo = esRespaldo ? (c.respaldo ?? "429") : (c.modelo ?? "ok");
    let pedido = {};
    try {
      pedido = JSON.parse(bodyText ?? "{}");
    } catch {}
    const ultimo = [...(pedido.messages ?? [])].reverse().find((m) => m.role === "user")?.content;
    anotar({ destino: esRespaldo ? "respaldo" : "modelo", url, modo, ultimo });
    if (!/chat\/completions/.test(url)) return json({ error: "sin esto en el laboratorio" }, 404);
    if (modo === "429") return json({ error: { message: "sin cupo simulado" } }, 429);
    if (modo === "colgado") return esperarCorte(init.signal);
    if (c.colgarSi && String(ultimo).includes(c.colgarSi)) return esperarCorte(init.signal);
    return respuestaModelo(pedido, c);
  }
  return real(input, init);
};
