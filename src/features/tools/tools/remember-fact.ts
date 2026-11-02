import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  kind: z
    .enum(["need", "goal", "objection", "commitment", "risk", "fact"])
    .describe(
      "Tipo: need (necesidad), goal (objetivo), objection (objeción), commitment (compromiso de alguna de las partes), risk (riesgo de perder al cliente), fact (dato)",
    ),
  text: z
    .string()
    .min(3)
    .max(300)
    .describe("Lo que hay que recordar, en una frase corta"),
  quote: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Las palabras EXACTAS del cliente que lo respaldan, copiadas de su mensaje",
    ),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { saveClaim } = await import("@/features/arm/services/claims");
  const saved = await saveClaim({
    workspaceId: ctx.workspaceId,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    kind: args.kind,
    text: args.text,
    quote: args.quote,
  });
  return {
    ok: true,
    output: {
      saved: true,
      grounded: saved.grounded,
      message: saved.grounded
        ? "Guardado con su fuente."
        : "Guardado como corazonada: la cita no coincide con ningún mensaje del cliente.",
    },
  };
}

export const rememberFactTool: Tool<Args> = {
  name: "remember_fact",
  description:
    "Guarda en la memoria del cliente una necesidad, objetivo, objeción, compromiso, riesgo o dato importante que dijo. Citá sus palabras exactas en quote. No se lo menciones al cliente.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
