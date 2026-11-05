import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";
import { hasCardOrBankNumber } from "@/features/inbox/services/sensitive-data";
import { hasSpecialCategoryData } from "@/features/privacy/privacy-rules";

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
  if (hasCardOrBankNumber(`${args.text} ${args.quote ?? ""}`)) {
    return { ok: false, output: null, error: "No se guardan números de tarjeta ni de cuenta en la memoria." };
  }
  if (hasSpecialCategoryData(`${args.text} ${args.quote ?? ""}`)) {
    return { ok: false, output: null, error: "No se guardan datos de salud, religión, política ni vida sexual en la memoria." };
  }
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
    "Guarda en la memoria del cliente algo importante que dijo, para recordarlo en las próximas charlas. " +
    "Usala cada vez que el cliente mencione una necesidad, un objetivo, un evento con fecha (casamiento, viaje), una objeción, un compromiso o un dato personal relevante, aunque también le respondas otra cosa. " +
    "Citá sus palabras exactas en quote. No guardes datos de salud, religión, política ni vida sexual. Devuelve si se guardó. No se lo menciones al cliente.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
