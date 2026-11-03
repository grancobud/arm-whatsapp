import type { ZodSchema } from "zod";

export type ToolSensitivity = "read" | "write" | "sensitive";

export interface ToolContext {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  // SEC-01: identity anchored server-side — LLM cannot override these
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
  requiresConfirmation?: boolean; // SEC-01: true for sensitive tools pending human approval
}

export interface ToolRunOptions {
  timeoutMs?: number; // default 10_000
  retries?: number; // default 1
  /** ARM: set only by the approval flow — lets a sensitive tool actually run. */
  approvedProposalId?: string;
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  sensitivity: ToolSensitivity;
  schema: ZodSchema<TArgs>;
  /**
   * JSON Schema sent to the model instead of one derived from `schema`. Set by
   * tools whose schema comes from outside (MCP servers); `schema` then only
   * checks that the args are an object, and the remote server validates them.
   */
  jsonSchema?: Record<string, unknown>;
  enabledFor(workspaceId: string): boolean | Promise<boolean>;
  run(
    args: TArgs,
    ctx: ToolContext,
    opts?: ToolRunOptions,
  ): Promise<ToolResult>;
}
