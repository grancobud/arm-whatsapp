// ¿Cuánto del system prompt se puede reutilizar entre dos mensajes del mismo cliente?
// Los proveedores con caché automática (prefix caching) solo reutilizan el
// COMIENZO idéntico del prompt: si arranca con algo que cambia (la hora), nada.
//
// 1) Mide el prefijo común entre dos turnos reales (otra hora, memoria y fragmentos).
// 2) Lo prueba contra un proveedor que informa caché (qwen3.7-plus por FreeLLMAPI).
//
// Uso: npm run eval:cache

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildSystemPrompt } from "../../src/features/inbox/services/prompt-builder.ts";
import { buildBusinessInfoContext } from "../../src/features/inbox/services/business-info.ts";
import { starterPrompt } from "../../src/features/agents/lib/starter-prompts.ts";
import { NEGOCIO } from "../agente/negocio.ts";

const MODELO = process.argv.find((a) => a.startsWith("--modelo="))?.split("=")[1] || "qwen3.7-plus";

const turno = (hora: string, memoria: string, kb: string) =>
  buildSystemPrompt({
    nowContext: `## Fecha actual\nHoy es martes, 3 de noviembre de 2026, ${hora} (zona horaria America/Argentina/Buenos_Aires, offset -03:00).`,
    summary: memoria ? "El cliente pregunta por turnos." : "",
    memoryContext: memoria,
    bizContext: buildBusinessInfoContext(NEGOCIO),
    kbContext: kb,
    promptBase: starterPrompt("setter", "Barbería El Faro", "Martín"),
    toolNames: ["check_availability", "schedule_highlevel", "remember_fact"],
    guardrails: { rules: ["Respondé siempre en castellano."], restrictions: ["Hablar de política."] },
  });

const a = turno("11:00", "", "");
const b = turno("11:07", "## Lo que sabemos del cliente\n<memoria_cliente>\n- [need, con fuente] «Quiere un degradé»\n</memoria_cliente>", "## Base de Conocimiento\n<base_conocimiento>\n<fragmento fuente=\"Manual\">Turnos cada 40 minutos.</fragmento>\n</base_conocimiento>");
let comun = 0;
while (comun < a.length && a[comun] === b[comun]) comun++;
console.log(`Prompt: ${b.length} caracteres · comienzo idéntico entre dos turnos: ${comun} (${Math.round((100 * comun) / b.length)}%)`);

const proveedor = createOpenAI({
  baseURL: process.env.EVAL_BASE_URL || "http://localhost:31415/v1",
  apiKey: process.env.EVAL_API_KEY || process.env.FREELLMAPI_KEY,
});
for (const [i, hora] of ["11:00", "11:03", "11:06", "11:09"].entries()) {
  try {
    const r = await generateText({
      model: proveedor.chat(MODELO),
      system: turno(hora, "", ""),
      prompt: `hola, consulta ${i + 1}`,
      maxOutputTokens: 20,
    });
    const d = r.usage.inputTokenDetails;
    console.log(`  turno ${i + 1} (${hora}): entrada ${r.usage.inputTokens} tokens · desde caché ${d?.cacheReadTokens ?? 0} · ${r.response.modelId}`);
  } catch (err) {
    console.log(`  turno ${i + 1}: error ${String(err).slice(0, 100)}`);
  }
}
