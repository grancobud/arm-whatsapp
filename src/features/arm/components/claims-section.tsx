"use client";

/**
 * claims-section.tsx — "Lo que sabemos" block of the CRM panel.
 * Each claim shows the customer's own words when it has a source, or is drawn
 * as a hunch when nothing backs it.
 */

import { useEffect, useState, useTransition } from "react";
import { Brain, ChevronDown, ChevronUp, Quote, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { listContactClaims, retractClaim } from "../services/arm-actions";
import { CLAIM_KIND_LABELS, type ClaimRow } from "../types";

export function ClaimsSection({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(true);
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listContactClaims(contactId).then((res) => {
      if (!cancelled) setClaims(res.ok ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  function handleRetract(id: string) {
    startTransition(async () => {
      const res = await retractClaim(id);
      if (res.ok) {
        setClaims((prev) => (prev ?? []).filter((c) => c.id !== id));
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
      >
        <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5" aria-hidden="true" />
          Lo que sabemos
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-4 py-3 space-y-2">
          {claims === null && (
            <p className="text-[11px] text-muted-foreground">Cargando…</p>
          )}
          {claims?.length === 0 && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              Todavía no hay datos. El agente los guarda a medida que el cliente
              cuenta necesidades, objeciones o compromisos.
            </p>
          )}
          {claims?.map((c) => {
            const grounded = !!c.source_message_id;
            return (
              <div
                key={c.id}
                className="rounded-md border border-border/50 p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {CLAIM_KIND_LABELS[c.kind]}
                    </Badge>
                    {!grounded && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-dashed text-muted-foreground"
                        title="Ningún mensaje del cliente lo respalda"
                      >
                        corazonada
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetract(c.id)}
                    disabled={isPending}
                    aria-label="Descartar dato"
                    title="Descartar: no es correcto"
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p
                  className={
                    grounded
                      ? "text-xs text-foreground"
                      : "text-xs text-muted-foreground italic"
                  }
                >
                  {c.text}
                </p>
                {grounded && c.quote && (
                  <p className="text-[10px] text-muted-foreground flex gap-1">
                    <Quote className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                    <span>«{c.quote}»</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
