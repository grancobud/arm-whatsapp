import type { AgentType } from "@/features/agents/types";

// Per-role metadata: labels, taglines, and prompt-writing guidance. Reused by
// the agent cards and the guided prompt editor (Fase 3).

export interface AgentTypeMeta {
  label: string;
  tagline: string;
  /** Bullet guidance shown in the guided prompt editor. */
  promptGuidance: string[];
}

export const AGENT_TYPE_META: Record<AgentType, AgentTypeMeta> = {
  setter: {
    label: "Ventas",
    tagline: "Califica interesados y saca turnos",
    promptGuidance: [
      "Definí el objetivo: calificar y sacar turno.",
      "Listá las preguntas clave para calificar (presupuesto, urgencia, etc.).",
      "Indicá cuándo pasar a una persona.",
      "Tono: amable, profesional y directo. Mensajes cortos.",
    ],
  },
  soporte: {
    label: "Soporte",
    tagline: "Resuelve dudas con precisión",
    promptGuidance: [
      "Describí los temas que el agente puede resolver.",
      "Definí qué hacer cuando no sabe la respuesta (pasar a una persona).",
      "Aclará el tono: empático y claro.",
      "Recordale usar la base de conocimiento si existe.",
    ],
  },
  agendamiento: {
    label: "Agendamiento",
    tagline: "Reserva y confirma turnos",
    promptGuidance: [
      "Explicá cómo agenda (link o calendario directo).",
      "Qué datos pedir antes de reservar.",
      "Cómo confirmar y recordar el turno.",
      "Tono: eficiente y cordial.",
    ],
  },
};
