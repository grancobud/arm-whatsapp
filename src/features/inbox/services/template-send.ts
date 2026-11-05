import { createServiceClient as svc } from "@/lib/supabase/service";
// Sends an approved template on the business's behalf, outside a person's
// hands (automations, kept promises). Templates with no variables go as is;
// with exactly one, it is filled with the contact's first name. Anything else
// is skipped: we have no data to fill it with and a wrong value is worse.


export type TemplateSendResult =
  | { status: "sent"; detail: string }
  | { status: "skipped"; detail: string }
  | { status: "failed"; detail: string };


export async function sendApprovedTemplate(params: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  templateName: string;
}): Promise<TemplateSendResult> {
  const db = svc();
  const name = params.templateName;

  const { data: tpl } = await db
    .from("templates")
    .select("language, variables")
    .eq("workspace_id", params.workspaceId)
    .eq("name", name)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (!tpl) return { status: "skipped", detail: `la plantilla ${name} no está aprobada` };

  const vars = Array.isArray(tpl.variables) ? tpl.variables : [];
  if (vars.length > 1) {
    return { status: "skipped", detail: "la plantilla pide más de un dato; usá una sin variables o con solo el nombre" };
  }
  let components;
  if (vars.length === 1) {
    const { data: contact } = await db.from("contacts").select("name").eq("id", params.contactId).single();
    const firstName = ((contact?.name as string | null) ?? "").trim().split(/\s+/)[0];
    if (!firstName) return { status: "skipped", detail: "la plantilla pide el nombre y el contacto no tiene" };
    components = [{ type: "body" as const, parameters: [{ type: "text" as const, text: firstName }] }];
  }

  const { dispatchTemplate } = await import("./dispatch");
  const r = await dispatchTemplate({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    templateName: name,
    templateLanguage: tpl.language as string,
    components,
  });
  if (r.ok) return { status: "sent", detail: `plantilla ${name}` };
  if (r.error?.startsWith("OPT_OUT")) return { status: "skipped", detail: "el contacto no quiere mensajes" };
  return { status: "failed", detail: r.error ?? "error" };
}
