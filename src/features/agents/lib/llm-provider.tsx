"use client";

// Which model provider the server talks to. With LLM_BASE_URL set (FreeLLMAPI or
// any OpenAI-compatible endpoint) the OpenRouter catalog ids don't exist there,
// so model pickers offer that endpoint's models instead. The flag is read on
// the server (settings page) and handed down through this context.

import { createContext, useContext, type ReactNode } from "react";

const LlmProviderContext = createContext<{ custom: boolean }>({ custom: false });

export function LlmProviderProvider({ custom, children }: { custom: boolean; children: ReactNode }) {
  return <LlmProviderContext.Provider value={{ custom }}>{children}</LlmProviderContext.Provider>;
}

export const useLlmProvider = () => useContext(LlmProviderContext);
