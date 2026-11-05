"use client";

// F3-T5: Visual badge for conversation state.

import {
  Bot,
  User,
  AlertCircle,
  Clock,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationState } from "@/features/inbox/types";

interface StateBadgeProps {
  state: ConversationState;
}

const STATE_CONFIG: Record<
  ConversationState,
  {
    label: string;
    className: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  ai_active: {
    label: "IA activa",
    className: "text-[hsl(var(--electric-lime))]",
    Icon: Bot,
  },
  human_active: {
    label: "Persona",
    className: "text-blue-400",
    Icon: User,
  },
  handoff_pending: {
    label: "Espera persona",
    className: "text-amber-400",
    Icon: AlertCircle,
  },
  waiting_reply: {
    label: "Esperando",
    className: "text-muted-foreground",
    Icon: Clock,
  },
  paused: {
    label: "Pausado",
    className: "text-muted-foreground",
    Icon: PauseCircle,
  },
  closed: {
    label: "Cerrado",
    className: "text-muted-foreground/50",
    Icon: XCircle,
  },
};

export function StateBadge({ state }: StateBadgeProps) {
  const config = STATE_CONFIG[state];

  if (!config) return null;

  const { label, className, Icon } = config;

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", className)}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
