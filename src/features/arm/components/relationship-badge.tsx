"use client";

// Relationship score at the top of the CRM panel: a number, a word and the
// reason, so a person sees at a glance whether this customer is cooling off.

import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContactRelationshipAction } from "../services/arm-actions";
import type { Relationship, RelationshipStatus } from "../services/relationship";

export const STATUS_LABELS: Record<RelationshipStatus, string> = {
  activa: "Activa",
  enfriandose: "Enfriándose",
  fria: "Fría",
  perdida: "Perdida",
  baja: "De baja",
  nueva: "Nueva",
};

const STATUS_COLORS: Record<RelationshipStatus, string> = {
  activa: "bg-primary/10 text-primary",
  enfriandose: "bg-warning/10 text-warning",
  fria: "bg-info/10 text-info",
  perdida: "bg-muted text-muted-foreground",
  baja: "bg-muted text-muted-foreground",
  nueva: "bg-muted text-muted-foreground",
};

export function RelationshipBadge({ contactId }: { contactId: string }) {
  const [rel, setRel] = useState<Relationship | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getContactRelationshipAction(contactId).then((r) => {
      if (!cancelled) setRel(r.ok ? r.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (!rel) return null;

  return (
    <div className="px-4 py-2.5 border-b border-border/40 flex items-start gap-2.5">
      <HeartPulse className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">Relación</span>
          <span className="font-display text-sm font-semibold tabular-nums" title="Puntaje de 0 a 100">
            {rel.score}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[rel.status])}>
            {STATUS_LABELS[rel.status]}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">{rel.reason}</p>
      </div>
    </div>
  );
}
