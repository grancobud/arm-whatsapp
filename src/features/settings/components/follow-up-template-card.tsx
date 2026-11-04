"use client";

// Which approved template keeps the agent's promises when they fall outside
// WhatsApp's 24h window (free text can't be sent then). Without one, those
// promises go to a person by email.

import { useEffect, useState, useTransition } from "react";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getFollowUpTemplate, saveFollowUpTemplate } from "../services/automation-actions";
import type { TemplateRow } from "@/features/inbox/services/templates";

const NONE = "__none__";

export function FollowUpTemplateCard({
  workspaceId,
  templates,
}: {
  workspaceId: string;
  templates: TemplateRow[];
}) {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  // Templates with more than one variable can't be filled automatically.
  const usable = templates.filter(
    (t) => t.status === "approved" && (Array.isArray(t.variables) ? t.variables.length : 0) <= 1,
  );

  useEffect(() => {
    void getFollowUpTemplate(workspaceId).then((r) => setValue(r.data ?? null));
  }, [workspaceId]);

  function handleChange(next: string) {
    const name = next === NONE ? null : next;
    const prev = value;
    setValue(name);
    startTransition(async () => {
      const r = await saveFollowUpTemplate(workspaceId, name);
      if (r.error) {
        setValue(prev);
        toast.error(r.error);
      } else {
        toast.success(name ? "Plantilla guardada" : "Las promesas fuera de las 24 h irán a una persona");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <HandHeart className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Promesas del agente</p>
          <p className="text-xs text-muted-foreground">
            Cuando el agente promete «te escribo el jueves», lo cumple solo. Si para ese día pasaron más
            de 24 h desde el último mensaje del cliente, WhatsApp solo deja mandar una plantilla aprobada:
            elegí una de utilidad (las de marketing solo llegan a quien aceptó promociones). Sin
            plantilla, te llega un mail para que le escriba una persona.
          </p>
        </div>
      </div>
      <Select
        value={value === undefined ? undefined : (value ?? NONE)}
        onValueChange={handleChange}
        disabled={value === undefined || isPending}
      >
        <SelectTrigger className="sm:max-w-sm" aria-label="Plantilla para promesas fuera de las 24 h">
          <SelectValue placeholder="Cargando…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Ninguna: que la mande una persona</SelectItem>
          {usable.map((t) => (
            <SelectItem key={t.id} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {usable.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No hay plantillas aprobadas con a lo sumo una variable (el nombre). Creá una en Plantillas.
        </p>
      )}
    </div>
  );
}
