import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool, zodSchema, jsonSchema, stepCountIs, APICallError } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { checkReply, stripThinking } from "./reply-guard";
import { splitCitations } from "./kb-citations";

// Customer-facing replies should be consistent, not creative: the same
// question should get the same answer. An agent can override it.
export const DEFAULT_TEMPERATURE = 0.3;

// OpenRouter occasionally returns transient upstream errors (502/503/504) when a
// provider hiccups. Retry idempotent, side-effect-free completions a couple of
// times with a short backoff before surfacing the failure.
function isTransientError(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    if (err.isRetryable) return true;
    const code = err.statusCode;
    return typeof code === "number" && code >= 500 && code < 600;
  }
  return false;
}

async function withTransientRetry<T>(
  fn: () => Promise<T>,
  {
    retries = 2,
    baseDelayMs = 400,
  }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
import { createClient as svcClient } from "@supabase/supabase-js";
import type {
  Tool as ForgeTool,
  ToolContext,
} from "@/features/tools/core/tool";
import { registry } from "@/features/tools/index";
import { getActiveAgent } from "@/features/agents/services/active-agent";
import { decryptCredentials } from "@/shared/lib/integration-secrets";
import {
  buildModelChain,
  runWithModelChain,
  UnusableReplyError,
  DEFAULT_FALLBACK_CHAIN,
} from "./model-chain";

function logFallback(where: string) {
  return (a: { model: string; error: string }, next: string) =>
    console.warn(`[openrouter:${where}] ${a.model} fallo (${a.error}); pruebo ${next}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// getWorkspaceModel
// The active agent's model wins; otherwise reads the workspace's openrouter
// integration model. Falls back to the env default, then to gpt-4o-mini.
// ──────────────────────────────────────────────────────────────────────────────

export async function getWorkspaceModel(workspaceId: string): Promise<string> {
  // Active agent model takes precedence (back-compat: null when no agent).
  const agent = await getActiveAgent(workspaceId);
  if (agent?.model) return agent.model;

  try {
    const db = svcClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data } = await db
      .from("integrations")
      .select("config")
      .eq("workspace_id", workspaceId)
      .eq("provider", "openrouter")
      .maybeSingle();

    // The Integraciones → OpenRouter section writes `default_model`; older
    // config used `model`. Read either so the workspace fallback keeps working
    // after the standalone "IA & Modelos" tab was consolidated away.
    const config = data?.config as Record<string, unknown> | null;
    const model = config?.default_model ?? config?.model;

    if (typeof model === "string" && model.length > 0) {
      return model;
    }
  } catch {
    // Non-fatal — fall through to env default
  }

  return process.env.OPENROUTER_DEFAULT_MODEL ?? DEFAULT_FALLBACK_CHAIN[0];
}

// ──────────────────────────────────────────────────────────────────────────────
// getOpenRouterApiKey
// Per-workspace key from the OpenRouter integration (credentials.openrouter_api_key);
// falls back to the OPENROUTER_API_KEY env var when none is configured.
// ──────────────────────────────────────────────────────────────────────────────
export async function getOpenRouterApiKey(
  workspaceId?: string,
): Promise<string> {
  const envKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!workspaceId) return envKey;

  try {
    const db = svcClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await db
      .from("integrations")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider", "openrouter")
      .maybeSingle();

    const creds = await decryptCredentials(
      data?.credentials as Record<string, unknown> | null,
      workspaceId,
      "openrouter",
    );
    const key = creds.openrouter_api_key;
    if (typeof key === "string" && key.length > 0) return key;
  } catch {
    // Non-fatal — fall through to env key
  }
  return envKey;
}

// ──────────────────────────────────────────────────────────────────────────────
// createChatProvider
// OpenRouter by default. Setting LLM_BASE_URL points every chat reply at any
// OpenAI-compatible endpoint instead (e.g. FreeLLMAPI behind a tunnel), with
// LLM_API_KEY as its key; per-workspace OpenRouter keys are then ignored.
// Pair it with OPENROUTER_DEFAULT_MODEL / OPENROUTER_FALLBACK_MODELS set to
// model ids that endpoint knows (FreeLLMAPI: "auto").
// ──────────────────────────────────────────────────────────────────────────────
// Some reasoning models (Gemini behind an OpenAI-compatible endpoint) return a
// thought_signature on each tool call and reject the next step (400) unless it
// is sent back. Kept per warm instance and capped so it cannot grow forever.
const thoughtSignatures = new Map<string, string>();
const MAX_THOUGHT_SIGNATURES = 500;

async function createChatProvider(workspaceId?: string) {
  const customBaseUrl = process.env.LLM_BASE_URL?.trim();
  return createOpenAI({
    baseURL: customBaseUrl || "https://openrouter.ai/api/v1",
    apiKey: customBaseUrl
      ? (process.env.LLM_API_KEY ?? "")
      : await getOpenRouterApiKey(workspaceId),
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "ARM WhatsApp",
    },
    fetch: async (url, init) => {
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body);
          if (Array.isArray(parsed.messages)) {
            let modified = false;
            for (const msg of parsed.messages) {
              if (Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                  const sig = thoughtSignatures.get(tc.id);
                  if (sig && !tc.extra_content) {
                    tc.extra_content = { google: { thought_signature: sig } };
                    modified = true;
                  }
                }
              }
            }
            if (modified) {
              init = { ...init, body: JSON.stringify(parsed) };
            }
          }
        } catch {
          // non-fatal
        }
      }

      const res = await fetch(url, init);
      const text = await res.text();

      try {
        const data = JSON.parse(text);
        if (Array.isArray(data.choices)) {
          for (const choice of data.choices) {
            if (Array.isArray(choice.message?.tool_calls)) {
              for (const tc of choice.message.tool_calls) {
                const sig = tc.extra_content?.google?.thought_signature;
                if (tc.id && sig) {
                  thoughtSignatures.set(tc.id, sig);
                  if (thoughtSignatures.size > MAX_THOUGHT_SIGNATURES) {
                    const oldest = thoughtSignatures.keys().next().value;
                    if (oldest !== undefined) thoughtSignatures.delete(oldest);
                  }
                }
              }
            }
          }
        }
      } catch {
        // non-fatal
      }

      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    },
  });
}

/** External (MCP) tools bring their own JSON Schema; ours are Zod. */
function toolInputSchema(t: ForgeTool) {
  return t.jsonSchema ? jsonSchema(t.jsonSchema as Parameters<typeof jsonSchema>[0]) : zodSchema(t.schema);
}

/**
 * Never send a truncated, empty or leaked-reasoning reply: throw so the chain
 * tries the next model. After a tool ran an empty text is fine (the tool was
 * the answer), but other failures still throw — the chain then stops instead
 * of repeating the side effect, and nothing broken reaches the customer.
 */
function guardReply<R extends { text: string; finishReason: string }>(
  r: R,
  model: string,
  toolsRan: boolean,
): { r: R; text: string; citedIds: string[] } {
  // The "FUENTES: F1" line is for the team (kb-citations): strip it BEFORE the
  // check, so a reply that is only that line counts as empty and is retried.
  const { text, ids } = splitCitations(r.text);
  const check = checkReply(text, r.finishReason);
  if (check.ok || (toolsRan && check.reason === "empty")) {
    return { r, text: check.text, citedIds: ids };
  }
  throw new UnusableReplyError(model, check.reason);
}

// ──────────────────────────────────────────────────────────────────────────────
// generateReply — backward-compatible, no tools
// ──────────────────────────────────────────────────────────────────────────────

export interface GenerateReplyResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** The model that actually answered (may differ from the requested one after a fallback). */
  modelUsed?: string;
}

interface GenerateReplyParams {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  /** Resolves the per-workspace OpenRouter key; falls back to env when omitted. */
  workspaceId?: string;
}

/**
 * Generates a reply using OpenRouter as the AI gateway.
 *
 * Returns the generated text and token usage counts.
 * Internally maps AI SDK v6 field names (inputTokens / outputTokens)
 * to the stable promptTokens / completionTokens interface used
 * by cost-tracker throughout the application.
 */
export async function generateReply(
  params: GenerateReplyParams,
): Promise<GenerateReplyResult> {
  const { systemPrompt, userMessage } = params;

  const modelId =
    params.model ??
    process.env.OPENROUTER_DEFAULT_MODEL ??
    "openai/gpt-4o-mini";

  const openrouter = await createChatProvider(params.workspaceId);

  const { result, model: modelUsed } = await runWithModelChain(
    buildModelChain(modelId),
    async (m) => {
      const r = await generateText({
        model: openrouter.chat(m),
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: DEFAULT_TEMPERATURE,
        // Un solo reintento por modelo: si sigue fallando, conviene pasar al siguiente de la cadena.
        maxRetries: 1,
        maxOutputTokens: 1024,
      });
      const check = checkReply(r.text, r.finishReason);
      if (!check.ok) throw new UnusableReplyError(m, check.reason);
      return { r, text: check.text };
    },
    { onFallback: logFallback("reply") },
  );

  // AI SDK v6 exposes inputTokens / outputTokens; map to stable naming
  const promptTokens = result.r.usage?.inputTokens ?? 0;
  const completionTokens = result.r.usage?.outputTokens ?? 0;

  return {
    text: result.text,
    promptTokens,
    completionTokens,
    modelUsed,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// generateChatReply — multi-turn, no tools (used by the agent test playground)
// ──────────────────────────────────────────────────────────────────────────────

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function generateChatReply(params: {
  model?: string;
  systemPrompt: string;
  messages: ChatTurn[];
  maxOutputTokens?: number;
  /** Resolves the per-workspace OpenRouter key; falls back to env when omitted. */
  workspaceId?: string;
  /** Optional tool-calling: when provided, the model can invoke these tools. */
  tools?: ForgeTool[];
  /** Overrides DEFAULT_TEMPERATURE (agent config). */
  temperature?: number;
  toolContext?: ToolContext;
}): Promise<GenerateReplyResult> {
  const modelId =
    params.model ??
    process.env.OPENROUTER_DEFAULT_MODEL ??
    "openai/gpt-4o-mini";

  const openrouter = await createChatProvider(params.workspaceId);

  // Bridge Forge tools → AI SDK ToolSet (same shape as generateWithTools).
  // `toolsRan` blocks the model fallback once a tool had side effects.
  let toolsRan = false;
  const aiTools: ToolSet = {};
  if (params.tools && params.toolContext) {
    const ctx = params.toolContext;
    for (const forgeTool of params.tools) {
      aiTools[forgeTool.name] = tool({
        description: forgeTool.description,
        inputSchema: toolInputSchema(forgeTool),
        execute: async (args: unknown): Promise<unknown> => {
          if (forgeTool.sensitivity !== "read") toolsRan = true;
          return registry.runTool(forgeTool, args, ctx);
        },
      });
    }
  }
  const hasTools = Object.keys(aiTools).length > 0;

  const { result, model: modelUsed } = await runWithModelChain(
    buildModelChain(modelId),
    async (m) => {
      const r = await withTransientRetry(() =>
        generateText({
          model: openrouter.chat(m),
          system: params.systemPrompt,
          messages: params.messages,
          temperature: params.temperature ?? DEFAULT_TEMPERATURE,
          tools: hasTools ? aiTools : undefined,
          stopWhen: hasTools ? stepCountIs(5) : undefined,
          // Un solo reintento por modelo: si sigue fallando, conviene pasar al siguiente de la cadena.
        maxRetries: 1,
        maxOutputTokens: params.maxOutputTokens ?? 512,
        }),
      );
      return guardReply(r, m, toolsRan);
    },
    { hasSideEffects: () => toolsRan, onFallback: logFallback("chat") },
  );

  return {
    text: result.text,
    promptTokens: result.r.usage?.inputTokens ?? 0,
    completionTokens: result.r.usage?.outputTokens ?? 0,
    modelUsed,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// generateWithTools — AI SDK v6 tool-calling variant
// ──────────────────────────────────────────────────────────────────────────────

export interface GenerateWithToolsParams {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  workspaceId: string;
  availableTools?: ForgeTool[];
  toolContext: ToolContext;
  /** Prior conversation turns (oldest→newest), injected between system and the current batch. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Overrides DEFAULT_TEMPERATURE (agent config). */
  temperature?: number;
}

export interface GenerateWithToolsResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCallsExecuted: number;
  /** The model that actually answered (may differ from the requested one after a fallback). */
  modelUsed?: string;
  /** Knowledge-base fragment ids the reply cited ("F1"…), see kb-citations. */
  citedIds: string[];
}

/**
 * Generates a reply with optional AI SDK v6 tool-calling.
 *
 * Bridges Forge Tool definitions into AI SDK v6 Tool objects using
 * inputSchema + execute. SEC-01: ToolContext is always server-anchored —
 * the LLM cannot supply or override workspaceId, conversationId, or contactId.
 *
 * In AI SDK v6 multi-step loops are controlled via stopWhen: stepCountIs(n).
 */
export async function generateWithTools(
  params: GenerateWithToolsParams,
): Promise<GenerateWithToolsResult> {
  const modelId =
    params.model ??
    process.env.OPENROUTER_DEFAULT_MODEL ??
    "openai/gpt-4o-mini";

  const openrouter = await createChatProvider(params.workspaceId);

  // Build AI SDK v6 ToolSet from available Forge tools.
  // Each entry uses inputSchema (zodSchema wrapper) + execute — the correct v6 shape.
  // execute returns Promise<unknown> to satisfy ToolSet's output constraint.
  const aiTools: ToolSet = {};
  // Once a tool ran (it may have booked, tagged or messaged), a failure must NOT
  // be retried with another model: that would repeat the side effect.
  let toolsRan = false;

  for (const forgeTool of params.availableTools ?? []) {
    const ctx = params.toolContext;
    aiTools[forgeTool.name] = tool({
      description: forgeTool.description,
      inputSchema: zodSchema(forgeTool.schema),
      execute: async (args: unknown): Promise<unknown> => {
        // A read (e.g. check_availability) is safe to repeat with another model.
        if (forgeTool.sensitivity !== "read") toolsRan = true;
        // runTool, not run(name): a workspace's MCP tools are not in the shared registry.
        return registry.runTool(forgeTool, args, ctx);
      },
    });
  }

  const hasTools = Object.keys(aiTools).length > 0;

  // Same messages for every model in the chain: the conversation thread is kept.
  const { result, model: modelUsed } = await runWithModelChain(
    buildModelChain(modelId),
    async (m) => {
      const messages: ModelMessage[] = [
        ...(params.history ?? []),
        { role: "user", content: params.userMessage },
      ];
      const r = await generateText({
        model: openrouter.chat(m),
        system: params.systemPrompt,
        messages,
        temperature: params.temperature ?? DEFAULT_TEMPERATURE,
        tools: hasTools ? aiTools : undefined,
        stopWhen: hasTools ? stepCountIs(5) : undefined,
        // Un solo reintento por modelo: si sigue fallando, conviene pasar al siguiente de la cadena.
        maxRetries: 1,
        maxOutputTokens: 1024,
      });

      // After tools the model may stop without writing (it answered only with a
      // tool call, or the 5 steps ran out mid-tool). The customer would get
      // nothing — e.g. a booked slot with no confirmation. One closing call
      // without tools turns the tool results into a reply.
      if (hasTools && r.steps.length > 1 && !stripThinking(r.text)) {
        const closing = await generateText({
          model: openrouter.chat(m),
          system: params.systemPrompt,
          messages: [...messages, ...r.response.messages],
          temperature: params.temperature ?? DEFAULT_TEMPERATURE,
          maxRetries: 1,
          maxOutputTokens: 600,
        });
        return guardReply(
          {
            text: closing.text,
            finishReason: closing.finishReason,
            steps: r.steps.length + 1,
            usage: {
              inputTokens: (r.totalUsage?.inputTokens ?? 0) + (closing.usage?.inputTokens ?? 0),
              outputTokens: (r.totalUsage?.outputTokens ?? 0) + (closing.usage?.outputTokens ?? 0),
            },
          },
          m,
          toolsRan,
        );
      }
      return guardReply(
        // totalUsage, not usage: usage is only the last step, and with tools
        // the cost guard would undercount every multi-step turn.
        { text: r.text, finishReason: r.finishReason, steps: r.steps.length, usage: r.totalUsage },
        m,
        toolsRan,
      );
    },
    { hasSideEffects: () => toolsRan, onFallback: logFallback("tools") },
  );

  return {
    text: result.text,
    inputTokens: result.r.usage?.inputTokens ?? 0,
    outputTokens: result.r.usage?.outputTokens ?? 0,
    toolCallsExecuted: result.r.steps,
    modelUsed,
    citedIds: result.citedIds,
  };
}
