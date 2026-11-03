"use client";

// «Lo que aprendió el agente»: the corrections the team made, which go into
// its prompt. Removing one stops the agent from following it.

import { useEffect, useState, useTransition } from "react";
import { GraduationCap, X } from "lucide-react";
import { toast } from "sonner";
import { archiveLesson, listLessons, type LessonItem } from "../services/arm-actions";

const SOURCE_LABELS: Record<string, string> = {
  rejected_proposal: "Al rechazar una propuesta",
  message_correction: "Al corregir una respuesta",
  manual: "Cargada a mano",
};

export function LessonsCard({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [items, setItems] = useState<LessonItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void listLessons(workspaceId).then((r) => setItems(r.ok ? r.data : []));
  }, [workspaceId]);

  function remove(id: string) {
    startTransition(async () => {
      const r = await archiveLesson(id);
      if (r.ok) setItems((prev) => (prev ?? []).filter((l) => l.id !== id));
      else toast.error(r.error);
    });
  }

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <GraduationCap className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Lo que aprendió el agente</p>
          <p className="text-xs text-muted-foreground">
            Cada vez que rechazás una propuesta en Revisión o tocás «Corregir» en una respuesta de la IA,
            lo que escribís queda acá y el agente lo sigue en las próximas charlas (las 15 más nuevas).
          </p>
        </div>
      </div>
      {items === null && <p className="text-[11px] text-muted-foreground">Cargando…</p>}
      {items?.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Todavía no hay correcciones.</p>
      )}
      <ul className="space-y-2">
        {items?.map((l) => (
          <li key={l.id} className="rounded-md border border-border/50 p-2 flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs text-foreground">{l.lesson}</p>
              <p className="text-[10px] text-muted-foreground">
                {SOURCE_LABELS[l.source] ?? l.source} · {new Date(l.created_at).toLocaleDateString("es-AR")}
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => remove(l.id)}
                disabled={isPending}
                aria-label="Quitar corrección"
                title="Quitar: el agente deja de seguirla"
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
