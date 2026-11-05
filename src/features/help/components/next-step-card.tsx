import Link from "next/link";
import { FIRST_STEPS, nextSetupStep } from "@/features/help/help-content";
import type { SetupStatus } from "@/features/help/setup-status";

/** What to do next while the setup is incomplete. Renders nothing once it is done. */
export function NextStepCard({ status }: { status: SetupStatus }) {
  const step = nextSetupStep(status);
  if (!step) return null;

  const tracked = FIRST_STEPS.filter((s) => s.setupKey);
  const done = tracked.filter((s) => status[s.setupKey!]).length;

  return (
    <section
      aria-label="Tu próximo paso"
      className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-left"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-foreground">Tu próximo paso</h2>
        <p className="text-xs text-muted-foreground shrink-0">
          {done} de {tracked.length} listos
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{step.title}</p>
        <p className="text-xs text-muted-foreground">{step.why}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={step.link.href}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {step.link.label}
        </Link>
        <Link href="/ayuda" className="text-xs text-primary underline-offset-4 hover:underline">
          Ver la guía completa
        </Link>
      </div>
      {step.setupKey === "whatsapp" && (
        <p className="text-xs text-muted-foreground">
          ¿Todavía no tenés número? Podés{" "}
          <Link href="/settings?tab=agentes" className="text-primary underline-offset-4 hover:underline">
            probar al agente
          </Link>{" "}
          igual: no se manda nada por WhatsApp.
        </p>
      )}
    </section>
  );
}
