"use client";

/**
 * follow-ups-section.tsx — "Promesas" block of the CRM panel: what the agent
 * promised this customer and when it goes out. A person can cancel a pending
 * one (e.g. they already called).
 */

import { useEffect, useState, useTransition } from "react";
import { HandHeart, ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cancelFollowUp, listContactFollowUps, type FollowUpItem } from "../services/arm-actions";

const STATUS_LABELS: Record<string, string> = {
  pending: "pendiente",
  sending: "saliendo",
  sent: "cumplida",
  needs_human: "la tiene que mandar una persona",
  cancelled: "cancelada",
  failed: "falló",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FollowUpsSection({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState<FollowUpItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listContactFollowUps(contactId).then((res) => {
      if (!cancelled) setItems(res.ok ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  function handleCancel(id: string) {
    startTransition(async () => {
      const res = await cancelFollowUp(id);
      if (res.ok) {
        setItems((prev) =>
          (prev ?? []).map((f) => (f.id === id ? { ...f, status: "cancelled" } : f)),
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  // Nothing promised yet: keep the panel short.
  if (items !== null && items.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
      >
        <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider flex items-center gap-1.5">
          <HandHeart className="h-3.5 w-3.5" aria-hidden="true" />
          Promesas
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-4 py-3 space-y-2">
          {items === null && <p className="text-[11px] text-muted-foreground">Cargando…</p>}
          {items?.map((f) => (
            <div key={f.id} className="rounded-md border border-border/50 p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant={f.status === "pending" ? "default" : "secondary"} className="text-[10px]">
                    {STATUS_LABELS[f.status] ?? f.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{when(f.due_at)}</span>
                </div>
                {f.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleCancel(f.id)}
                    disabled={isPending}
                    aria-label="Cancelar promesa"
                    title="Cancelar: no mandar este mensaje"
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {f.reason && <p className="text-xs text-foreground">{f.reason}</p>}
              <p className="text-[11px] text-muted-foreground">«{f.message}»</p>
              {f.detail && f.status !== "sent" && (
                <p className="text-[10px] text-muted-foreground italic">{f.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
