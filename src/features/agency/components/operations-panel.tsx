import type { OperationsSummary } from "../services/operations";

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/** Cómo anduvo ARM en las últimas 24 horas, sin contenido de ninguna conversación. */
export function OperationsPanel({ data }: { data: OperationsSummary }) {
  const unreviewedShare = data.turns ? Math.round((data.unreviewed / data.turns) * 100) : 0;
  const rows: { label: string; value: string; alert?: boolean }[] = [
    { label: "Respuestas", value: String(data.turns) },
    { label: "Tiempo mediano", value: seconds(data.medianMs) },
    { label: "Tiempo p95", value: seconds(data.p95Ms) },
    { label: "Sin revisar", value: `${data.unreviewed} (${unreviewedShare}%)`, alert: unreviewedShare >= 20 },
    { label: "Clientes sin respuesta", value: String(data.noReply), alert: data.noReply > 0 },
    { label: "Envíos fallidos", value: String(data.sendFailures), alert: data.sendFailures > 0 },
    { label: "Cambios de proveedor", value: String(data.providerSwitches), alert: data.providerSwitches > 0 },
    { label: "Fallas de búsqueda", value: String(data.knowledgeFailures), alert: data.knowledgeFailures > 0 },
    { label: "Traspasos forzados", value: String(data.forcedHandoffs) },
    { label: "Guardias que actuaron", value: String(data.guardsActed) },
  ];
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Operación, últimas 24 horas</h2>
        <p className="text-xs text-muted-foreground">
          {data.models.length
            ? `Modelos: ${data.models.map((m) => `${m.model} (${m.turns})`).join(", ")}`
            : "Todavía no hay respuestas registradas."}
        </p>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className={`text-lg font-semibold ${r.alert ? "text-destructive" : ""}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
