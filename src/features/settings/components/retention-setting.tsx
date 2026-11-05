"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

const OPTIONS = [
  { value: 6, label: "6 meses" },
  { value: 12, label: "12 meses" },
  { value: 24, label: "24 meses" },
  { value: 0, label: "No borrar por antigüedad" },
];

export function RetentionSetting({ workspaceId }: { workspaceId: string }) {
  const [months, setMonths] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const url = `/api/workspace/${workspaceId}/privacy`;

  useEffect(() => {
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read"))))
      .then((json: { retentionMonths: number }) => setMonths(json.retentionMonths))
      .catch(() => toast.error("No se pudo leer el plazo de conservación"));
  }, [url]);

  async function save(next: number) {
    const previous = months;
    setMonths(next);
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionMonths: next }),
      });
      if (!res.ok) throw new Error("save");
      toast.success("Plazo guardado");
    } catch {
      setMonths(previous);
      toast.error("No se pudo guardar el plazo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-2">
      <label htmlFor="retention-months" className="font-medium">
        Cuánto tiempo se guardan los datos
      </label>
      <p className="text-xs text-muted-foreground">
        Si un contacto no tiene actividad durante este plazo, se borran sus datos, conversaciones y
        archivos. No se puede deshacer.
      </p>
      <select
        id="retention-months"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={months ?? ""}
        disabled={months === null || saving}
        onChange={(e) => save(Number(e.target.value))}
      >
        {months === null && <option value="">Cargando...</option>}
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
