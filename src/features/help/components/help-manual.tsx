/**
 * help-manual.tsx — /ayuda: the step-by-step manual, with the first steps
 * marked done from the real state of the workspace. Static: no client code.
 */

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { DAILY_TASKS, FAQ, FIRST_STEPS, SCREENS, type HelpLink, type HelpStep } from "../help-content";
import type { SetupStatus } from "../setup-status";

const SECTIONS = [
  { id: "primeros-pasos", label: "Primeros pasos" },
  { id: "dia-a-dia", label: "El día a día" },
  { id: "pantallas", label: "Cada pantalla" },
  { id: "preguntas", label: "Preguntas comunes" },
];

export function HelpManual({ status }: { status: SetupStatus | null }) {
  const checkable = FIRST_STEPS.filter((step) => step.setupKey);
  const done = status ? checkable.filter((step) => status[step.setupKey!]).length : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 space-y-10">
      <header className="space-y-3">
        <h1 className="font-display text-xl font-semibold text-foreground">Ayuda</h1>
        <p className="text-sm text-muted-foreground">
          Cómo poner en marcha tu agente de WhatsApp y cómo usarlo todos los días.
        </p>
        <nav aria-label="Secciones de la ayuda" className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {section.label}
            </a>
          ))}
        </nav>
      </header>

      <section id="primeros-pasos" className="scroll-mt-20 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-foreground">Primeros pasos</h2>
          <p className="text-sm text-muted-foreground">
            Seguilos en orden.
            {status && ` Ya tenés ${done} de ${checkable.length} configurados: se marcan solos.`}
          </p>
        </div>
        <ol className="space-y-3">
          {FIRST_STEPS.map((step, index) => (
            <StepCard
              key={step.title}
              step={step}
              number={index + 1}
              done={status && step.setupKey ? status[step.setupKey] : null}
            />
          ))}
        </ol>
      </section>

      <section id="dia-a-dia" className="scroll-mt-20 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-foreground">El día a día</h2>
          <p className="text-sm text-muted-foreground">
            Con el agente andando, esto es lo que hace tu equipo.
          </p>
        </div>
        <ul className="space-y-3">
          {DAILY_TASKS.map((step) => (
            <StepCard key={step.title} step={step} />
          ))}
        </ul>
      </section>

      <section id="pantallas" className="scroll-mt-20 space-y-4">
        <h2 className="font-display text-base font-semibold text-foreground">Para qué sirve cada pantalla</h2>
        <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
          {SCREENS.map((screen) => (
            <li key={screen.name}>
              <Link
                href={screen.href}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-foreground">{screen.name}</span>
                  <span className="block text-muted-foreground">{screen.text}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="preguntas" className="scroll-mt-20 space-y-4">
        <h2 className="font-display text-base font-semibold text-foreground">Preguntas comunes</h2>
        <div className="space-y-2">
          {FAQ.map((item) => (
            <details key={item.question} className="group rounded-xl border border-border/60 px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                {item.answer.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {item.link && <GoTo link={item.link} />}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function StepCard({
  step,
  number,
  done = null,
}: {
  step: HelpStep;
  number?: number;
  done?: boolean | null;
}) {
  return (
    <li className="rounded-xl border border-border/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          {number !== undefined && `${number}. `}
          {step.title}
          {step.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">Opcional</span>}
        </h3>
        {done !== null && <SetupBadge done={done} />}
      </div>
      <p className="text-sm text-muted-foreground">{step.why}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {step.how.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <GoTo link={step.link} />
    </li>
  );
}

function SetupBadge({ done }: { done: boolean }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs ${done ? "text-primary" : "text-muted-foreground"}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {done ? "Listo" : "Falta"}
    </span>
  );
}

function GoTo({ link }: { link: HelpLink }) {
  return (
    <Link
      href={link.href}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {link.label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
