"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  TrendingUp,
  HeadphonesIcon,
  CalendarDays,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeOnboarding } from "../services/onboarding-actions";
import type { OnboardingInput } from "../services/onboarding-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type UseCase = "setter" | "soporte" | "agendamiento" | "general";

interface WizardState {
  useCase: UseCase | null;
  businessName: string;
  industry: string;
  description: string;
  ycloudApiKey: string;
  ycloudPhone: string;
  ycloudSigningSecret: string;
}

// ─── Use case cards data ──────────────────────────────────────────────────────

const USE_CASES: {
  id: UseCase;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "setter",
    label: "Ventas",
    description: "Califica interesados, saca turnos y cierra ventas por WhatsApp.",
    icon: <TrendingUp className="h-5 w-5" aria-hidden />,
  },
  {
    id: "soporte",
    label: "Soporte al cliente",
    description:
      "Resuelve dudas y pasa a una persona cuando hace falta.",
    icon: <HeadphonesIcon className="h-5 w-5" aria-hidden />,
  },
  {
    id: "agendamiento",
    label: "Agendamiento",
    description:
      "Reserva y confirma turnos con tus clientes.",
    icon: <CalendarDays className="h-5 w-5" aria-hidden />,
  },
  {
    id: "general",
    label: "General",
    description:
      "Asistente virtual flexible para responder preguntas y dar información.",
    icon: <Sparkles className="h-5 w-5" aria-hidden />,
  },
];

// ─── Progress bar ─────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={[
            "h-1.5 flex-1 rounded-full transition-colors duration-300",
            i < current
              ? "bg-primary"
              : i === current
                ? "bg-primary/60"
                : "bg-muted",
          ].join(" ")}
          aria-hidden
        />
      ))}
      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
        {current + 1} / {total}
      </span>
    </div>
  );
}

// ─── Step 1 — Use case selection ──────────────────────────────────────────────

function Step1({
  selected,
  onSelect,
}: {
  selected: UseCase | null;
  onSelect: (id: UseCase) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          ¿Para qué vas a usar el agente?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Con esto armamos las instrucciones iniciales de tu agente. Las podés
          cambiar después.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {USE_CASES.map((uc) => (
          <button
            key={uc.id}
            type="button"
            onClick={() => onSelect(uc.id)}
            className={[
              "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
              "hover:border-primary/60 hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === uc.id
                ? "border-primary bg-primary/10 ring-1 ring-primary"
                : "border-border bg-card",
            ].join(" ")}
            aria-pressed={selected === uc.id}
          >
            <span
              className={[
                "flex h-9 w-9 items-center justify-center rounded-lg",
                selected === uc.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {uc.icon}
            </span>
            <span className="font-medium text-foreground text-sm">
              {uc.label}
            </span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {uc.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2 — Business info ───────────────────────────────────────────────────

function Step2({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Información del negocio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El agente usará estos datos para presentarse y responder con contexto.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="business-name">
            Nombre del negocio <span className="text-destructive">*</span>
          </Label>
          <Input
            id="business-name"
            placeholder="Barbería El Faro"
            value={state.businessName}
            onChange={(e) => onChange({ businessName: e.target.value })}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="industry">Industria / Giro</Label>
          <Input
            id="industry"
            placeholder="Barbería, tienda online, inmobiliaria..."
            value={state.industry}
            onChange={(e) => onChange({ industry: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descripción breve</Label>
          <Textarea
            id="description"
            placeholder="Somos una barbería en Palermo. Hacemos cortes, barba y corte infantil..."
            value={state.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Esta descripción enriquece el prompt base del agente.
          </p>
        </div>

        <p className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
          WhatsApp no permite algunos rubros, entre ellos drogas, alcohol, tabaco,
          armas, productos médicos, préstamos de día de pago y marketing multinivel,
          y puede bloquear el número. Revisá la{" "}
          <a
            href="https://whatsappbusiness.com/es-la/policy/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            política de WhatsApp
          </a>{" "}
          antes de conectar uno.
        </p>
      </div>
    </div>
  );
}

// ─── Step 3 — YCloud connection ───────────────────────────────────────────────

function Step3({
  state,
  onChange,
  isTesting,
  onTest,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  isTesting: boolean;
  onTest: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Conectar YCloud
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Opcional. Con la clave alcanza: buscamos tu número y dejamos lista
          la conexión. Lo podés completar más tarde desde Configuración →
          Integraciones.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ycloud-key">API Key YCloud</Label>
          <Input
            id="ycloud-key"
            type="password"
            placeholder="yk_..."
            value={state.ycloudApiKey}
            onChange={(e) => onChange({ ycloudApiKey: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ycloud-phone">
            Número de WhatsApp (solo si tu cuenta de YCloud tiene más de uno)
          </Label>
          <Input
            id="ycloud-phone"
            type="tel"
            placeholder="+5491123456789"
            value={state.ycloudPhone}
            onChange={(e) => onChange({ ycloudPhone: e.target.value })}
          />
        </div>

        {state.ycloudApiKey && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            aria-busy={isTesting}
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            ) : null}
            Probar conexión
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 4 — Summary ─────────────────────────────────────────────────────────

function Step4({
  state,
  whatsappConnected,
}: {
  state: WizardState;
  whatsappConnected: boolean;
}) {
  const useCaseLabel =
    USE_CASES.find((u) => u.id === state.useCase)?.label ?? state.useCase ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
        </span>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          ¡Todo listo!
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Tu workspace ha sido creado. Aquí un resumen de lo configurado.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <Row label="Negocio" value={state.businessName} />
        {state.industry && <Row label="Industria" value={state.industry} />}
        <Row label="Tipo de agente" value={useCaseLabel} />
        <Row label="Instrucciones iniciales" value="Generado automáticamente" />
        {state.ycloudApiKey && (
          <Row
            label="WhatsApp"
            value={
              whatsappConnected
                ? "Conectado"
                : "Clave guardada. Terminá la conexión en Configuración → Integraciones"
            }
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Podés ajustar todo esto en Configuración → Integraciones y
        Configuración → Prompt.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span
        className={[
          "text-xs text-right text-foreground",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export function OnboardingWizard() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<
    string | null
  >(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  const [state, setState] = useState<WizardState>({
    useCase: null,
    businessName: "",
    industry: "",
    description: "",
    ycloudApiKey: "",
    ycloudPhone: "",
    ycloudSigningSecret: "",
  });

  function patch(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function canAdvance(): boolean {
    if (step === 0) return state.useCase !== null;
    if (step === 1) return state.businessName.trim().length > 0;
    return true;
  }

  async function handleNext() {
    if (step === 2) {
      // Finalize — call server action
      await handleFinalize();
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleFinalize() {
    setIsSubmitting(true);
    try {
      const input: OnboardingInput = {
        useCase: state.useCase!,
        businessName: state.businessName.trim(),
        industry: state.industry.trim() || undefined,
        description: state.description.trim() || undefined,
        ycloudApiKey: state.ycloudApiKey.trim() || undefined,
        ycloudPhone: state.ycloudPhone.trim() || undefined,
      };

      const result = await completeOnboarding(input);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setCompletedWorkspaceId(result.workspaceId ?? null);
      setWhatsappConnected(result.whatsappConnected === true);
      setStep(3);
    } catch (err) {
      console.error("[OnboardingWizard] handleFinalize error:", err);
      toast.error("Error inesperado al crear el cliente");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTestYCloud() {
    if (!state.ycloudApiKey) return;
    setIsTesting(true);
    try {
      // Proxy through the server so the API key isn't exposed to the browser
      // and the request isn't CORS-blocked.
      const res = await fetch("/api/integrations/ycloud/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: state.ycloudApiKey }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        balance?: { balance?: number; currency?: string };
        error?: string;
      };
      if (json.ok) {
        const balance =
          typeof json.balance?.balance === "number"
            ? json.balance.balance
            : "?";
        const currency = json.balance?.currency ?? "";
        toast.success(`YCloud conectado — Saldo: ${balance} ${currency}`);
      } else {
        toast.error(json.error ?? "API Key inválida o sin acceso");
      }
    } catch {
      toast.error("No se pudo conectar con YCloud");
    } finally {
      setIsTesting(false);
    }
  }

  const isLastDataStep = step === 2;
  const isComplete = step === 3;

  return (
    <div className="w-full max-w-lg mx-auto">
      <StepIndicator current={step} total={TOTAL_STEPS} />

      {step === 0 && (
        <Step1
          selected={state.useCase}
          onSelect={(id) => patch({ useCase: id })}
        />
      )}
      {step === 1 && <Step2 state={state} onChange={patch} />}
      {step === 2 && (
        <Step3
          state={state}
          onChange={patch}
          isTesting={isTesting}
          onTest={handleTestYCloud}
        />
      )}
      {step === 3 && completedWorkspaceId && (
        <Step4 state={state} whatsappConnected={whatsappConnected} />
      )}

      <div className="flex items-center justify-between mt-8">
        {step > 0 && !isComplete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={isSubmitting}
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden />
            Atrás
          </Button>
        ) : (
          <div />
        )}

        {!isComplete ? (
          <Button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance() || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            ) : null}
            {isLastDataStep ? "Finalizar" : "Continuar"}
            {!isLastDataStep && !isSubmitting && (
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
            )}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => router.push("/inbox")}
            className="w-full sm:w-auto"
          >
            Ir al inbox
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
