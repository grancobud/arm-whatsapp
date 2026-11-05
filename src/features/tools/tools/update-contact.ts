import { z } from "zod";
import type { Tool, ToolContext, ToolResult, ToolRunOptions } from "../core/tool";
import {
  decideContactUpdate,
  invalidContactValue,
} from "@/features/arm/services/contact-update-rules";

const schema = z.object({
  field: z.enum(["name", "email"]).describe("Qué dato: name (nombre) o email (correo)"),
  value: z.string().min(2).max(200).describe("El valor, tal como lo escribió el cliente"),
  quote: z.string().min(2).max(500).describe("Las palabras exactas del cliente donde aparece el dato"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext, opts?: ToolRunOptions): Promise<ToolResult> {
  const invalid = invalidContactValue(args.field, args.value, args.quote);
  if (invalid) return { ok: false, output: null, error: invalid };
  // El chat de prueba no tiene contacto: no hay ficha que cambiar.
  if (!ctx.contactId || !ctx.conversationId) {
    return { ok: true, output: { saved: false, simulated: true } };
  }

  const { findSourceMessage } = await import("@/features/arm/services/claims");
  const sourceMessageId = await findSourceMessage(ctx.conversationId, args.quote);
  if (!sourceMessageId) {
    return { ok: false, output: null, error: "Esas palabras no están en lo que escribió el cliente." };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: contact } = await db
    .from("contacts")
    .select("name, email")
    .eq("id", ctx.contactId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!contact) return { ok: false, output: null, error: "No se encontró el contacto" };

  const value = args.value.trim();
  const current = contact[args.field] as string | null;
  const decision = decideContactUpdate(current, value);
  if (decision === "same") return { ok: true, output: { saved: false, already_had_it: true } };

  // Pisar un dato distinto lo decide una persona en Revisión.
  if (decision === "propose" && !opts?.approvedProposalId) {
    const { createProposal, pendingApprovalResult } = await import("../registry");
    return pendingApprovalResult(await createProposal("update_contact", args, ctx));
  }

  const { error } = await db
    .from("contacts")
    .update({ [args.field]: value, updated_at: new Date().toISOString() })
    .eq("id", ctx.contactId)
    .eq("workspace_id", ctx.workspaceId);
  if (error) return { ok: false, output: null, error: "No se pudo guardar el dato" };

  await db.from("contact_changes").insert({
    workspace_id: ctx.workspaceId,
    contact_id: ctx.contactId,
    conversation_id: ctx.conversationId,
    field: args.field,
    old_value: current,
    new_value: value,
    quote: args.quote,
    source_message_id: sourceMessageId,
    proposal_id: opts?.approvedProposalId ?? null,
  });
  return { ok: true, output: { saved: true, field: args.field } };
}

export const updateContactTool: Tool<Args> = {
  name: "update_contact",
  description:
    "Guarda en la ficha el nombre o el correo que el cliente te dio. Usala cuando te los diga. Citá sus palabras exactas en quote. " +
    "Si la ficha ya tiene otro valor, queda para que lo apruebe una persona. No se lo menciones al cliente.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
