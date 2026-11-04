import { detectsHandoffTrigger } from "@/features/inbox/services/state-machine";

export interface WithoutJevPreview {
  decision: "respond" | "handoff";
  reason: "keyword" | "sin-keyword";
}

/** Message-only view of today's path. Does not read state or rate limits. */
export function previewWithoutJev(text: string): WithoutJevPreview {
  if (detectsHandoffTrigger(text)) {
    return { decision: "handoff", reason: "keyword" };
  }
  return { decision: "respond", reason: "sin-keyword" };
}

const RULE_COPY: Record<string, string> = {
  "opt-out": "No contesta. La etapa pasaría a perdido.",
  confianza: "Confianza baja. No contesta y la etapa no se mueve.",
  handoff: "Pasa a una persona. La etapa no se mueve.",
  abstain: "No contesta. La etapa no se mueve.",
  "respond-sin-redactor": "La IA no contesta sola. Pasa a una persona.",
  "respond-caliente": "Contesta la IA. La etapa pasaría a calificado.",
  "respond-curioso": "Contesta la IA. La etapa pasaría a interesado.",
  "respond-frio": "Contesta la IA. La etapa no se mueve.",
  "respond-sin-etapa": "Contesta la IA. La etapa no se mueve.",
  "etapa-caliente": "Contesta la IA. La etapa pasaría a calificado.",
  "etapa-curioso": "Contesta la IA. La etapa pasaría a interesado.",
  "etapa-perdido": "Contesta la IA. La etapa pasaría a perdido.",
  "redactor-sigue": "Contesta la IA. La etapa no se mueve.",
};

export function ruleCopy(rule: string): string {
  return RULE_COPY[rule] ?? rule;
}
