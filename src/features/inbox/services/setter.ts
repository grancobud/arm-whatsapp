// F7: Setter mode — knockout qualification + scoring via structured LLM evaluation.

import { safeError } from "@/lib/safe-error";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getModel() {
  const openai = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY!,
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "ARM WhatsApp",
    },
  });
  // Use haiku-class model for structured outputs — cost-efficient.
  // OpenRouter only supports Chat Completions; force .chat() (the provider's
  // default callable uses the OpenAI Responses API, which OpenRouter rejects).
  return openai.chat(
    process.env.OPENROUTER_SETTER_MODEL ?? "openai/gpt-4o-mini",
  );
}

export interface SetterQuestion {
  id: string;
  text: string;
  type: string;
  weight: number;
}

export interface KnockoutRule {
  question_id: string;
  condition: string;
  action: string;
}

export interface SetterConfig {
  id: string;
  name: string;
  enabled: boolean;
  questions: SetterQuestion[];
  knockout_rules: KnockoutRule[];
  scoring: { threshold: number; max_score: number };
  post_action: Record<string, unknown>;
}

const EvalSchema = z.object({
  score: z.number().min(0).max(100),
  qualified: z.boolean(),
  summary: z.string().describe("2-3 sentence summary of the lead"),
  knocked_out: z.boolean(),
  // Nullable (not optional): OpenAI strict structured-output requires every
  // property to be in `required`; an optional field is rejected by the provider
  // ("'required' ... must include every key"). Use null when not knocked out.
  knockout_reason: z
    .string()
    .nullable()
    .describe("Reason if knocked out, else null"),
});

export type SetterEvaluation = z.infer<typeof EvalSchema>;

/**
 * Loads the active setter config for a workspace.
 * Returns null when no enabled config exists.
 */
export async function getSetterConfig(
  workspaceId: string,
): Promise<SetterConfig | null> {
  const supabase = svc();

  const { data, error } = await supabase
    .from("setter_configs")
    .select(
      "id, name, enabled, questions, knockout_rules, scoring, post_action",
    )
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[setter] getSetterConfig error:", safeError(error));
    return null;
  }

  if (!data) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    enabled: data.enabled as boolean,
    questions: (data.questions as SetterQuestion[]) ?? [],
    knockout_rules: (data.knockout_rules as KnockoutRule[]) ?? [],
    scoring: (data.scoring as { threshold: number; max_score: number }) ?? {
      threshold: 50,
      max_score: 100,
    },
    post_action: (data.post_action as Record<string, unknown>) ?? {},
  };
}

/**
 * Evaluates a lead based on the setter config and conversation history.
 * Uses generateObject for structured, type-safe scoring — never parses raw text.
 */
export async function evaluateLead(
  config: SetterConfig,
  conversationHistory: string,
): Promise<SetterEvaluation> {
  const questionsBlock = config.questions
    .map((q) => `- [${q.id}] ${q.text} (weight: ${q.weight}, type: ${q.type})`)
    .join("\n");

  const knockoutBlock = config.knockout_rules
    .map((r) => `- Question ${r.question_id}: if ${r.condition} → ${r.action}`)
    .join("\n");

  const prompt = `You are a sales qualification evaluator.

## Qualification Questions
${questionsBlock}

## Knockout Rules
${knockoutBlock}

## Scoring
- Threshold to qualify: ${config.scoring.threshold} / ${config.scoring.max_score}

## Conversation to Evaluate
${conversationHistory}

Evaluate the conversation against the qualification questions and knockout rules.
Compute a weighted score (0-100). Apply knockout rules first — if any knockout
condition is met, set knocked_out=true. Return a structured evaluation.`;

  const { object } = await generateObject({
    model: getModel(),
    schema: EvalSchema,
    prompt,
  });

  // Reconcile: a knocked-out lead cannot be qualified
  return {
    ...object,
    qualified: object.knocked_out
      ? false
      : object.score >= config.scoring.threshold,
  };
}
