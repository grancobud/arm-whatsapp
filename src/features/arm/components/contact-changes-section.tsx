"use client";

/**
 * contact-changes-section.tsx — Lo que el agente cambió en la ficha, con su fuente.
 * Una persona lo puede deshacer mientras nadie haya vuelto a cambiar ese campo.
 */

import { useEffect, useState, useTransition } from "react";
import { History, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listContactChanges,
  revertContactChange,
  type ContactChangeItem,
} from "../services/arm-actions";

const FIELD_LABELS: Record<string, string> = { name: "Nombre", email: "Correo" };

export function ContactChangesSection({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<ContactChangeItem[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listContactChanges(contactId).then((result) => {
      if (!cancelled && result.ok) setItems(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (items.length === 0) return null;

  function undo(id: string) {
    startTransition(async () => {
      const result = await revertContactChange(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Cambio deshecho");
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, reverted_at: new Date().toISOString() } : i)));
    });
  }

  return (
    <section className="px-4 py-3 border-t border-border/50 space-y-2">
      <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Cambios del agente
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="text-[11px] text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">{FIELD_LABELS[item.field] ?? item.field}:</span>{" "}
              {item.old_value || "(vacío)"} → {item.new_value}
            </p>
            {item.quote && <p className="italic">«{item.quote}»</p>}
            {item.reverted_at ? (
              <p>Deshecho</p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => undo(item.id)}
                className="h-6 text-[11px] gap-1"
              >
                <Undo2 className="h-3 w-3" aria-hidden="true" />
                Deshacer
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
