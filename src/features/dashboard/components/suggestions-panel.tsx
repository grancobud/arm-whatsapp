import Link from "next/link";
import { HeartPulse } from "lucide-react";
import type { Suggestion } from "@/features/arm/services/relationship";

const STAGE_LABELS: Record<string, string> = {
  customer: "Cliente",
  qualified: "Calificado",
  engaged: "Interesado",
  new: "Nuevo",
};

/** «Para escribirle hoy»: customers cooling off, best first. */
export function SuggestionsPanel({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <section className="space-y-3" aria-labelledby="para-hoy">
      <div>
        <h2 id="para-hoy" className="font-display text-sm font-semibold text-foreground flex items-center gap-1.5">
          <HeartPulse className="h-4 w-4 text-warning" aria-hidden="true" />
          Para escribirle hoy
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Clientes con los que había relación y se están enfriando.
        </p>
      </div>

      {suggestions.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-6 text-center">
          <p className="text-sm text-muted-foreground">Nadie se está enfriando. 👌</p>
        </div>
      ) : (
        <ul role="list" className="rounded-xl border border-border/50 bg-card divide-y divide-border/30 overflow-hidden">
          {suggestions.map((s) => (
            <li key={s.contactId}>
              <Link
                href={`/inbox/${s.conversationId}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {s.name ?? s.phone}
                    {STAGE_LABELS[s.stage] && (
                      <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                        {STAGE_LABELS[s.stage]}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{s.reason}</p>
                </div>
                <span className="font-display text-sm font-semibold tabular-nums text-foreground shrink-0" title="Puntaje de la relación (0 a 100)">
                  {s.score}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
