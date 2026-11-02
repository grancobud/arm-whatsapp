import { z } from "zod";
import type { Tool } from "../core/tool";

export const echoTool: Tool<{ msg: string }> = {
  name: "echo",
  description:
    "Devuelve el mismo mensaje que recibe. Solo sirve para probar que las herramientas funcionan de punta a punta; no la uses con clientes.",
  sensitivity: "read",
  schema: z.object({ msg: z.string() }),
  enabledFor: () => true,
  run: async ({ msg }) => ({ ok: true, output: msg }),
};
