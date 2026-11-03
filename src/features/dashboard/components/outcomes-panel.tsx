import { CalendarCheck, Star, Bot, Megaphone, HandHeart, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUTCOME_DAYS, REPLY_WINDOW_DAYS, type Outcomes } from "@/features/dashboard/services/outcomes";

function Stat({
  label,
  value,
  hint,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex items-start gap-3 bg-card",
        accent ? "border-primary/20 bg-primary/5" : "border-border/50",
      )}
    >
      <div
        className={cn(
          "shrink-0 rounded-lg p-2",
          accent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="font-display text-2xl font-semibold text-foreground tabular-nums">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

const AGENT_TYPES: Record<string, string> = {
  setter: "Setter",
  soporte: "Soporte",
  agendamiento: "Agendamiento",
};

const n = (v: number) => v.toLocaleString("es-AR");

export function OutcomesPanel({ outcomes: o }: { outcomes: Outcomes }) {
  const icon = "h-4 w-4";
  return (
    <section className="space-y-3" aria-labelledby="resultados">
      <div>
        <h2 id="resultados" className="font-display text-sm font-semibold text-foreground">
          Resultados · últimos {OUTCOME_DAYS} días
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lo que logró el agente, no cuánto habló.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat
          label="Turnos agendados"
          value={n(o.bookings)}
          hint={o.bookingLinks ? `y ${n(o.bookingLinks)} links para sacar turno` : undefined}
          icon={<CalendarCheck className={icon} aria-hidden="true" />}
          accent
        />
        <Stat
          label="Leads calificados"
          value={n(o.qualifiedLeads)}
          icon={<Star className={icon} aria-hidden="true" />}
        />
        <Stat
          label="Resueltas solo por la IA"
          value={o.aiOnlyPct === null ? "—" : `${o.aiOnlyPct}%`}
          hint={o.conversations ? `${n(o.aiOnlyConversations)} de ${n(o.conversations)} conversaciones` : "Todavía no hubo conversaciones"}
          icon={<Bot className={icon} aria-hidden="true" />}
        />
        {o.promises && (
          <Stat
            label="Promesas cumplidas"
            value={n(o.promises.kept)}
            hint={
              o.promises.needsHuman || o.promises.failed
                ? `${n(o.promises.needsHuman + o.promises.failed)} necesitaron una persona · ${n(o.promises.pending)} pendientes`
                : `${n(o.promises.pending)} pendientes`
            }
            icon={<HandHeart className={icon} aria-hidden="true" />}
          />
        )}
        <Stat
          label="Bajas"
          value={n(o.optOuts)}
          hint="Contactos que pidieron no recibir más mensajes"
          icon={<UserMinus className={icon} aria-hidden="true" />}
        />
      </div>

      {o.byAgent.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Resultados por agente</caption>
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium px-4 py-2">Agente</th>
                <th className="text-right font-medium px-4 py-2">Conversaciones</th>
                <th className="text-right font-medium px-4 py-2">Solo la IA</th>
                <th className="text-right font-medium px-4 py-2">Turnos</th>
                <th className="text-right font-medium px-4 py-2">Leads calificados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {o.byAgent.map((a) => (
                <tr key={a.agentId}>
                  <td className="px-4 py-2 text-foreground">
                    {a.name}
                    {AGENT_TYPES[a.type] && (
                      <span className="ml-2 text-[10px] text-muted-foreground">{AGENT_TYPES[a.type]}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(a.conversations)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{a.aiOnlyPct === null ? "—" : `${a.aiOnlyPct}%`}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(a.bookings)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(a.qualifiedLeads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/30">
            Cada resultado se cuenta para el agente que estaba activo en ese momento.
          </p>
        </div>
      )}

      {o.campaigns.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Resultado de cada campaña</caption>
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium px-4 py-2">
                  <Megaphone className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  Campaña
                </th>
                <th className="text-right font-medium px-4 py-2">Enviados</th>
                <th className="text-right font-medium px-4 py-2">Volvieron a escribir</th>
                <th className="text-right font-medium px-4 py-2">Bajas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {o.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-foreground">{c.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(c.sent)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {n(c.replied)}
                    <span className="text-muted-foreground"> ({c.sent ? Math.round((c.replied / c.sent) * 100) : 0}%)</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(c.optOuts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/30">
            «Volvieron a escribir»: contestaron dentro de los {REPLY_WINDOW_DAYS} días siguientes al envío.
          </p>
        </div>
      )}
    </section>
  );
}
