/**
 * arm-explainer.tsx — "What is an ARM and why this app is one", shown on the
 * login screen and the dashboard so the product name always comes with its
 * meaning. Static: no client code needed.
 */

import { Brain, CheckCircle2, Download, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

const PILLARS = [
  {
    icon: Brain,
    title: "Recuerda con fuentes",
    text: "Guarda necesidades, objeciones y compromisos de cada cliente citando el mensaje que lo dice. Lo que no tiene fuente queda como corazonada.",
  },
  {
    icon: CheckCircle2,
    title: "Propone y una persona decide",
    text: "Las acciones sensibles y las campañas esperan aprobación en Revisión antes de ejecutarse.",
  },
  {
    icon: Megaphone,
    title: "Sale a reactivar clientes",
    text: "Campañas a contactos con consentimiento; cuando responden, el agente sigue la charla.",
  },
  {
    icon: Download,
    title: "Los datos son tuyos",
    text: "Exportás todo cuando quieras desde Configuración → Datos.",
  },
] as const;

export function ArmExplainer({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4",
        className,
      )}
      aria-labelledby="arm-explainer-title"
    >
      <div className="space-y-1">
        <h2
          id="arm-explainer-title"
          className="font-display text-base font-semibold text-foreground"
        >
          ¿Qué es un ARM?
        </h2>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">
            ARM = Agent Relationship Management.
          </strong>{" "}
          Un CRM supone que una persona hace el trabajo y el sistema guarda la
          ficha. En un ARM, el agente de IA y tu equipo trabajan juntos la
          relación con cada cliente, y la ficha tiene que aguantar a los dos.
        </p>
      </div>

      {!compact && (
        <p className="text-xs font-medium uppercase tracking-wider text-primary">
          Por qué esta app es un ARM
        </p>
      )}

      <ul
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-1" : "sm:grid-cols-2",
        )}
      >
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <Icon
              className="h-4 w-4 shrink-0 mt-0.5 text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              {!compact && (
                <p className="text-xs text-muted-foreground leading-snug">
                  {text}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
