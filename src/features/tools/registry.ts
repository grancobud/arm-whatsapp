import { safeError } from "@/lib/safe-error";
import { createClient as createSbClient } from "@supabase/supabase-js";
import type {
  Tool,
  ToolContext,
  ToolResult,
  ToolRunOptions,
} from "./core/tool";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Tool timeout")), timeoutMs),
    ),
  ]);
}

/**
 * SEC-01: Strip sensitive fields from args before logging.
 * Never log values whose keys hint at secrets or tokens.
 */
function sanitizeArgs(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const BLOCKED_KEYS = /token|secret|key|password|auth|credential/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = BLOCKED_KEYS.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

async function logToolCall(
  name: string,
  args: unknown,
  result: ToolResult,
  latencyMs: number,
  ctx: ToolContext,
): Promise<void> {
  try {
    const supabase = svc();
    await supabase.from("events").insert({
      type: "tool_call",
      level: result.ok ? "info" : "error",
      workspace_id: ctx.workspaceId,
      conversation_id: ctx.conversationId,
      payload: {
        tool_name: name,
        args_summary: sanitizeArgs(args),
        result_ok: result.ok,
        latency_ms: latencyMs,
        error: result.error ?? null,
        requires_confirmation: result.requiresConfirmation ?? false,
      },
    });
  } catch (logErr) {
    // Fire-and-forget: never let logging failures surface to caller
    console.warn("[registry] logToolCall failed:", logErr);
  }
}

export async function createProposal(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<string | null> {
  try {
    const { data, error } = await svc()
      .from("agent_proposals")
      .insert({
        workspace_id: ctx.workspaceId,
        conversation_id: ctx.conversationId,
        contact_id: ctx.contactId,
        kind: "tool_call",
        tool_name: name,
        // Raw (validated) args: approval must replay exactly what was proposed.
        // They come from the model, never from integration credentials.
        args: args as Record<string, unknown>,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.warn("[registry] createProposal failed:", error?.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn("[registry] createProposal failed:", safeError(err));
    return null;
  }
}

/**
 * What the model reads when a sensitive tool is held for approval. If the
 * proposal could not be saved (DB error, or the agents playground, which has
 * no conversation), nobody will ever see it in /revision: the agent must not
 * promise a confirmation that is not coming.
 */
export function pendingApprovalResult(proposalId: string | null): ToolResult {
  return proposalId
    ? {
        ok: false,
        output: {
          pending_approval: true,
          proposal_id: proposalId,
          message:
            "La acción quedó pendiente de aprobación humana. No le digas al cliente que ya está hecha: decile que una persona del equipo la va a confirmar.",
        },
        requiresConfirmation: true,
        error: "Sensitive tool requires human approval before execution",
      }
    : {
        ok: false,
        output: {
          pending_approval: false,
          message:
            "No se pudo registrar el pedido para que lo apruebe una persona. No está hecho ni pendiente: no le prometas al cliente que alguien lo va a confirmar. Decile que ahora no lo podés gestionar y ofrecé que lo atienda una persona del equipo.",
        },
        // Still held: it did not run because it needs a person's approval.
        requiresConfirmation: true,
        error: "Sensitive tool held for approval, but the proposal could not be saved",
      };
}

// ──────────────────────────────────────────────────────────────────────────────
// ToolRegistry
// ──────────────────────────────────────────────────────────────────────────────

class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async run(
    name: string,
    args: unknown,
    ctx: ToolContext,
    opts?: ToolRunOptions,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: null, error: `Tool "${name}" not found` };
    }
    return this.runTool(tool, args, ctx, opts);
  }

  /**
   * Runs a tool object with the same guarantees as `run` (validation, human
   * approval for sensitive tools, timeout, retries, logging). Used for tools
   * that are not registered globally because they belong to ONE workspace
   * (its MCP servers): keeping them out of the shared Map means a tenant can
   * never reach another tenant's tool or credentials.
   */
  async runTool(
    tool: Tool,
    args: unknown,
    ctx: ToolContext,
    opts?: ToolRunOptions,
  ): Promise<ToolResult> {
    const name = tool.name;
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, output: null, error: parsed.error.message };
    }

    // SEC-01: sensitive tools require human confirmation — skip execution.
    // ARM: the request is persisted as a proposal; a manager approves it from
    // /revision, which re-enters here with approvedProposalId set.
    if (tool.sensitivity === "sensitive" && !opts?.approvedProposalId) {
      const proposalId = await createProposal(name, parsed.data, ctx);
      const pendingResult = pendingApprovalResult(proposalId);
      void logToolCall(name, args, pendingResult, 0, ctx);
      return pendingResult;
    }

    const timeoutMs = opts?.timeoutMs ?? 10_000;
    // The timeout does not cancel the first attempt, so a retry of a write tool
    // could run it twice (e.g. book the same slot twice). Only reads retry.
    const retries = opts?.retries ?? (tool.sensitivity === "read" ? 1 : 0);

    const attempt = () =>
      runWithTimeout(() => tool.run(parsed.data, ctx, opts), timeoutMs);

    const start = Date.now();
    let result: ToolResult;
    let lastError: string | undefined;

    for (let i = 0; i <= retries; i++) {
      try {
        result = await attempt();
        const latencyMs = Date.now() - start;
        // Fire-and-forget logging
        void logToolCall(name, args, result, latencyMs, ctx);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (i < retries) {
          console.warn(
            `[registry] tool "${name}" failed (attempt ${i + 1}), retrying:`,
            lastError,
          );
        }
      }
    }

    const errorResult: ToolResult = {
      ok: false,
      output: null,
      error: lastError ?? "Unknown tool error",
    };
    void logToolCall(name, args, errorResult, Date.now() - start, ctx);
    return errorResult;
  }

  async available(workspaceId: string): Promise<Tool[]> {
    const result: Tool[] = [];
    for (const tool of this.tools.values()) {
      if (await tool.enabledFor(workspaceId)) result.push(tool);
    }
    return result;
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const registry = new ToolRegistry();
