import type { ProviderKey } from "@/features/agents/components/provider-logos";

// ─────────────────────────────────────────────────────────────────────────────
// Curated, friendly model catalog. EDITABLE — add/rename as new models ship.
// `id` is the OpenRouter model id used at runtime; VERIFY each slug against the
// live list at https://openrouter.ai/api/v1/models before relying on it.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelTier = "premium" | "balanced" | "fast";

export interface CatalogModel {
  id: string; // OpenRouter id
  label: string; // friendly name shown to the user
  tier: ModelTier;
  recommendation: string; // "cuándo usar este modelo"
}

export interface CatalogProvider {
  provider: ProviderKey;
  label: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG: CatalogProvider[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      {
        id: "anthropic/claude-opus-4.8",
        label: "Claude Opus 4.8",
        tier: "premium",
        recommendation:
          "Lo más potente. Para ventas consultivas, razonamiento complejo y conversaciones de alto valor.",
      },
      {
        id: "anthropic/claude-sonnet-4.6",
        label: "Claude Sonnet 4.6",
        tier: "balanced",
        recommendation:
          "El mejor equilibrio calidad/costo. Recomendado por defecto para la mayoría de los agentes.",
      },
      {
        id: "anthropic/claude-haiku-4.5",
        label: "Claude Haiku 4.5",
        tier: "fast",
        recommendation:
          "Rápido y económico. Ideal para alto volumen y respuestas simples.",
      },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      {
        id: "openai/gpt-5.5",
        label: "GPT-5.5",
        tier: "premium",
        recommendation:
          "Máxima precisión y uso de herramientas. Para casos exigentes.",
      },
      {
        id: "openai/gpt-5.4",
        label: "GPT-5.4",
        tier: "premium",
        recommendation: "Muy capaz, ligeramente más económico que 5.5.",
      },
      {
        id: "openai/gpt-5.2",
        label: "GPT-5.2",
        tier: "balanced",
        recommendation: "Sólido y versátil para soporte general.",
      },
      {
        id: "openai/gpt-4.1",
        label: "GPT-4.1",
        tier: "balanced",
        recommendation: "Confiable y económico para tareas estándar.",
      },
      {
        id: "openai/gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        tier: "fast",
        recommendation:
          "El más económico. Para agendamiento y respuestas cortas de alto volumen.",
      },
    ],
  },
  {
    provider: "gemini",
    label: "Google Gemini",
    models: [
      {
        id: "google/gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        tier: "balanced",
        recommendation:
          "Contexto enorme y muy rápido. Bueno cuando necesitas procesar mucho texto.",
      },
      {
        id: "google/gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        tier: "fast",
        recommendation: "Rápido y barato para alto volumen.",
      },
      {
        id: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        tier: "premium",
        recommendation:
          "Más capacidad que Flash, manteniendo buena velocidad y contexto amplio.",
      },
    ],
  },
];

const FLAT_MODELS: { provider: ProviderKey; model: CatalogModel }[] =
  MODEL_CATALOG.flatMap((p) =>
    p.models.map((model) => ({ provider: p.provider, model })),
  );

export const ALL_CATALOG_IDS: string[] = FLAT_MODELS.map((m) => m.model.id);

export function findCatalogModel(
  id: string | null | undefined,
): { provider: ProviderKey; model: CatalogModel } | undefined {
  if (!id) return undefined;
  return FLAT_MODELS.find((m) => m.model.id === id);
}

/**
 * Models offered when the server uses its own endpoint (LLM_BASE_URL, e.g.
 * FreeLLMAPI). Short on purpose: "auto" lets the router pick a free model with
 * quota left, and mistral-medium-3.5 is the model the agent evals ran on.
 */
export const CUSTOM_ENDPOINT_MODELS: CatalogModel[] = [
  {
    id: "auto",
    label: "Automático (recomendado)",
    tier: "balanced",
    recommendation:
      "FreeLLMAPI elige un modelo gratis con cupo disponible y, si se agota, pasa a otro.",
  },
  {
    id: "mistral-medium-3.5",
    label: "Mistral Medium 3.5",
    tier: "balanced",
    recommendation:
      "Siempre el mismo modelo: es con el que se evaluó el agente (9,6/10).",
  },
];

export function findCustomEndpointModel(id: string | null | undefined): CatalogModel | undefined {
  return id ? CUSTOM_ENDPOINT_MODELS.find((m) => m.id === id) : undefined;
}

export const TIER_LABEL: Record<ModelTier, string> = {
  premium: "Premium",
  balanced: "Equilibrado",
  fast: "Rápido",
};
