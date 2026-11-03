"use client";

// «Corregir» on an AI reply: the person writes what it should have said or
// done, and the agent learns it as a rule of the workspace.

import { useState, useTransition } from "react";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { correctAiMessage } from "../services/arm-actions";

export function CorrectReply({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await correctAiMessage(messageId, text);
      if (res.ok) {
        toast.success("Listo: el agente lo va a tener en cuenta desde la próxima respuesta");
        setOpen(false);
        setText("");
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        title="Enseñarle al agente qué tendría que haber hecho"
      >
        <GraduationCap className="h-3 w-3" aria-hidden="true" />
        Corregir
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1.5 text-left">
      <label htmlFor={`fix-${messageId}`} className="text-[11px] text-muted-foreground">
        ¿Qué tendría que haber respondido o hecho? Queda como regla para este cliente.
      </label>
      <textarea
        id={`fix-${messageId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="Ej: No ofrezcas descuentos; derivá a una persona si piden precio por mayor."
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground">
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending || text.trim().length < 3}
          className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
        >
          Guardar corrección
        </button>
      </div>
    </div>
  );
}
