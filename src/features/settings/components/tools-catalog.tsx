"use client";

import { useState } from "react";
import {
  Settings2,
  ChevronDown,
  Lock,
  CalendarClock,
  CalendarPlus,
  CalendarSearch,
  Webhook,
  FlaskConical,
  Wrench,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ToolConfigPanel, CONFIGURABLE_TOOLS } from "./tool-config-panel";

interface ToolItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sensitivity: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

interface Props {
  workspaceId: string;
  initialTools: ToolItem[];
}

// Per-tool glyph so each row is scannable at a glance (annotation #2).
const TOOL_ICONS: Record<string, React.ElementType> = {
  schedule_link: CalendarClock,
  schedule_highlevel: CalendarPlus,
  check_availability: CalendarSearch,
  custom_webhook: Webhook,
  echo: FlaskConical,
};

// What each tool does, for the business owner. The catalog row in the DB keeps
// its English description; this is only what the screen shows.
const TOOL_DESCRIPTIONS: Record<string, string> = {
  schedule_link: "Le pasa al cliente un link para que saque turno solo.",
  schedule_highlevel: "Agenda el turno directo en el calendario de HighLevel.",
  check_availability: "Consulta los horarios libres reales del calendario de HighLevel.",
  remember_fact: "Guarda lo que el cliente cuenta (necesidad, objeción, compromiso, dato) citando su mensaje.",
  schedule_followup: "Cuando el agente promete escribirle al cliente más adelante, lo agenda y lo cumple.",
  custom_webhook: "Manda los datos a una URL tuya (HTTPS) para conectar otro sistema.",
};

// Internal test tools: never offered to a business.
const HIDDEN_TOOLS = new Set(["echo"]);

// Escalating treatment: read (blue) → write (amber) → sensitive (orange + lock).
// Orange (not destructive red) reads as "caution", not "error" (annotation #3).
const sensitivityConfig: Record<
  string,
  { label: string; className: string; Icon?: React.ElementType }
> = {
  read: {
    label: "lectura",
    className: "text-blue-400 border-blue-400/30",
  },
  write: {
    label: "escritura",
    className: "text-amber-400 border-amber-400/30",
  },
  sensitive: {
    label: "sensible",
    className: "text-orange-400 border-orange-400/30",
    Icon: Lock,
  },
};

export function ToolsCatalog({ workspaceId, initialTools }: Props) {
  const [tools, setTools] = useState<ToolItem[]>(() =>
    initialTools.filter((t) => !HIDDEN_TOOLS.has(t.key)),
  );
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  async function handleToggle(tool: ToolItem) {
    const newEnabled = !tool.enabled;

    // Optimistic update
    setTools((prev) =>
      prev.map((t) => (t.id === tool.id ? { ...t, enabled: newEnabled } : t)),
    );
    setPending((prev) => new Set(prev).add(tool.id));

    try {
      const res = await fetch(`/api/tools/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolKey: tool.key, enabled: newEnabled }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "No se pudo actualizar la herramienta");
      }

      toast.success(
        newEnabled ? `"${tool.name}" activado` : `"${tool.name}" desactivado`,
      );
    } catch (err) {
      // Rollback on error
      setTools((prev) =>
        prev.map((t) =>
          t.id === tool.id ? { ...t, enabled: tool.enabled } : t,
        ),
      );
      toast.error(
        err instanceof Error ? err.message : "No se pudo actualizar la herramienta",
      );
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(tool.id);
        return next;
      });
    }
  }

  if (tools.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No hay herramientas disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          Herramientas del agente
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Activá o desactivá lo que puede hacer el agente en este cliente.
        </p>
      </div>

      <ul className="space-y-2" role="list">
        {tools.map((tool) => {
          const sensitivity = tool.sensitivity ?? "read";
          const config =
            sensitivityConfig[sensitivity] ?? sensitivityConfig.read;
          const isToggling = pending.has(tool.id);
          const configurable = CONFIGURABLE_TOOLS.has(tool.key);
          const isOpen = expanded === tool.id;
          const ToolIcon = TOOL_ICONS[tool.key] ?? Wrench;
          const BadgeIcon = config.Icon;

          return (
            <li
              key={tool.id}
              className={cn(
                "rounded-lg border border-border/60 p-4 transition-colors duration-150 hover:border-primary/30",
                tool.enabled ? "bg-card" : "bg-muted/30",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ToolIcon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {tool.name}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "flex items-center gap-1 text-xs font-normal",
                        config.className,
                      )}
                    >
                      {BadgeIcon && (
                        <BadgeIcon className="h-3 w-3" aria-hidden="true" />
                      )}
                      {config.label}
                    </Badge>
                  </div>
                  {(TOOL_DESCRIPTIONS[tool.key] ?? tool.description) && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {TOOL_DESCRIPTIONS[tool.key] ?? tool.description}
                    </p>
                  )}
                  {configurable && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(tool.id)}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      aria-expanded={isOpen}
                    >
                      <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Configurar
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          isOpen && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>

                <Switch
                  checked={tool.enabled}
                  onCheckedChange={() => handleToggle(tool)}
                  disabled={isToggling}
                  aria-label={`${tool.enabled ? "Desactivar" : "Activar"} ${tool.name}`}
                />
              </div>

              {configurable && isOpen && (
                <div className="mt-4 border-t border-border/60 pt-4">
                  <ToolConfigPanel
                    workspaceId={workspaceId}
                    toolKey={tool.key}
                    initialConfig={tool.config}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
