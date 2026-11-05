"use client";

import { Settings2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { AGENT_TYPE_META } from "@/features/agents/lib/agent-meta";
import { findCatalogModel } from "@/features/agents/lib/model-catalog";
import { PROVIDER_LOGOS } from "./provider-logos";
import type { AgentDto } from "@/features/agents/types";

interface Props {
  agent: AgentDto;
  busy: boolean;
  onConfigure: (agent: AgentDto) => void;
  onTest: (agent: AgentDto) => void;
  onActivate: (agentId: string) => void;
}

export function AgentCard({ agent, busy, onConfigure, onTest, onActivate }: Props) {
  const meta = AGENT_TYPE_META[agent.type];
  const cat = findCatalogModel(agent.model);
  const Logo = cat ? PROVIDER_LOGOS[cat.provider] : null;
  const modelLabel = cat
    ? cat.model.label
    : (agent.model ?? "Modelo general");

  return (
    <Card
      className={cn(
        "flex flex-col gap-4 p-5 transition-colors",
        agent.isActive && "border-primary/40 bg-primary/5",
      )}
    >
      {/* Identity — name is always the leading element; the Activo badge never
          displaces it (same internal grid for active and inactive cards). */}
      <div className="flex items-start gap-3">
        <AgentAvatar
          avatarKey={agent.avatarKey}
          name={agent.name}
          className="h-14 w-14"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="font-display min-w-0 truncate font-semibold text-foreground">
              {agent.name}
            </h3>
            {agent.isActive && (
              <Badge className="shrink-0" variant="default">
                Activo
              </Badge>
            )}
          </div>
          <Badge variant="secondary" className="font-normal">
            {meta.label}
          </Badge>
        </div>
      </div>

      {/* Role description on its own line — no inline "·" separator that orphans
          the bullet at narrow widths. */}
      <p className="text-sm text-muted-foreground">{meta.tagline}</p>

      {/* Model on its own line, full and legible. */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Logo ? <Logo className="h-3.5 w-3.5 shrink-0" /> : null}
        <span className="truncate">{modelLabel}</span>
      </div>

      {/* Single-select activation: active shows a clear status, inactive shows
          an explicit "Activar" action (no ambiguous independent toggle). */}
      <div className="flex items-center gap-2 border-t border-border/60 pt-3">
        {agent.isActive ? (
          <span className="flex flex-1 items-center gap-1.5 text-xs font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Agente activo
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => onActivate(agent.id)}
          >
            Activar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => onTest(agent)}
        >
          Probar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => onConfigure(agent)}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          Configurar
        </Button>
      </div>
    </Card>
  );
}
