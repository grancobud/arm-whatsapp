"use client";

import { useState, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  saveAutomationRule,
  type AutomationRule,
  type TriggerType,
  type ActionType,
} from "../services/automation-actions";
import type { TemplateRow } from "@/features/inbox/services/templates";

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  first_message: "Primer mensaje del contacto",
  inactivity_24h: "Sin respuesta en 24h",
  window_closing: "Ventana de 24h cerrando (2h restantes)",
  handoff_requested: "IA solicita handoff",
  lead_qualified: "Lead calificado",
  keyword_match: "Palabra clave detectada",
};

const ACTION_LABELS: Record<ActionType, string> = {
  send_template: "Enviar template",
  assign_agent: "Asignar a agente",
  add_tag: "Agregar etiqueta",
  close_conversation: "Cerrar conversación",
  handoff_human: "Transferir a humano",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  rule?: AutomationRule;
  templates: TemplateRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AutomationRuleForm({
  workspaceId,
  rule,
  templates,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = Boolean(rule);
  const approvedTemplates = templates.filter((t) => t.status === "approved");

  const [name, setName] = useState(rule?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(
    rule?.trigger_type ?? "first_message",
  );
  const [actionType, setActionType] = useState<ActionType>(
    rule?.action_type ?? "send_template",
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [keywords, setKeywords] = useState<string>(
    Array.isArray(rule?.trigger_config?.keywords)
      ? (rule.trigger_config.keywords as string[]).join(", ")
      : "",
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    typeof rule?.action_config?.template_name === "string"
      ? rule.action_config.template_name
      : "",
  );
  const [tagName, setTagName] = useState<string>(
    typeof rule?.action_config?.tag === "string" ? rule.action_config.tag : "",
  );
  const [isLoading, setIsLoading] = useState(false);

  // Reset state when the sheet opens for a different rule
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync form fields from props when the sheet opens
      setName(rule?.name ?? "");
      setTriggerType(rule?.trigger_type ?? "first_message");
      setActionType(rule?.action_type ?? "send_template");
      setEnabled(rule?.enabled ?? true);
      setKeywords(
        Array.isArray(rule?.trigger_config?.keywords)
          ? (rule.trigger_config.keywords as string[]).join(", ")
          : "",
      );
      setSelectedTemplate(
        typeof rule?.action_config?.template_name === "string"
          ? rule.action_config.template_name
          : "",
      );
      setTagName(
        typeof rule?.action_config?.tag === "string"
          ? rule.action_config.tag
          : "",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.id]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const nameError =
    name.length > 0 && name.trim().length === 0
      ? "El nombre no puede estar vacío"
      : null;

  const canSubmit =
    name.trim().length > 0 &&
    !nameError &&
    (triggerType !== "keyword_match" || keywords.trim().length > 0) &&
    (actionType !== "send_template" || selectedTemplate.length > 0) &&
    (actionType !== "add_tag" || tagName.trim().length > 0);

  // ── Build configs ─────────────────────────────────────────────────────────

  function buildTriggerConfig(): Record<string, unknown> {
    if (triggerType === "keyword_match") {
      return {
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      };
    }
    return {};
  }

  function buildActionConfig(): Record<string, unknown> {
    switch (actionType) {
      case "send_template":
        return { template_name: selectedTemplate };
      case "add_tag":
        return { tag: tagName.trim() };
      default:
        return {};
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setIsLoading(true);
    const result = await saveAutomationRule(workspaceId, {
      id: rule?.id ?? undefined,
      name: name.trim(),
      enabled,
      trigger_type: triggerType,
      trigger_config: buildTriggerConfig(),
      action_type: actionType,
      action_config: buildActionConfig(),
    });

    setIsLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success(
      isEdit ? "Automatización actualizada" : "Automatización creada",
    );
    onSaved();
    onOpenChange(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="font-display">
            {isEdit ? "Editar automatización" : "Nueva automatización"}
          </SheetTitle>
          <SheetDescription>
            Definí cuándo se activa y qué hace automáticamente.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="rule-name"
              className="text-sm font-medium text-foreground"
            >
              Nombre de la regla
            </Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej. Bienvenida a nuevos contactos"
              maxLength={120}
              required
              className={cn(
                nameError
                  ? "border-destructive focus-visible:ring-destructive/30"
                  : "",
              )}
              aria-describedby={nameError ? "name-error" : undefined}
            />
            {nameError && (
              <p
                id="name-error"
                className="text-xs text-destructive flex items-center gap-1"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {nameError}
              </p>
            )}
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <Label
              htmlFor="rule-trigger"
              className="text-sm font-medium text-foreground"
            >
              Disparador
            </Label>
            <Select
              value={triggerType}
              onValueChange={(v) => setTriggerType(v as TriggerType)}
            >
              <SelectTrigger id="rule-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {TRIGGER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Keyword input — only shown for keyword_match */}
            {triggerType === "keyword_match" && (
              <div className="pt-1 space-y-1.5">
                <Label
                  htmlFor="rule-keywords"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Palabras clave{" "}
                  <span className="font-normal">(separadas por coma)</span>
                </Label>
                <Input
                  id="rule-keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="ej. precio, info, cotización"
                  className="h-8 text-sm"
                  aria-required="true"
                />
              </div>
            )}
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <Label
              htmlFor="rule-action"
              className="text-sm font-medium text-foreground"
            >
              Acción
            </Label>
            <Select
              value={actionType}
              onValueChange={(v) => setActionType(v as ActionType)}
            >
              <SelectTrigger id="rule-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACTION_LABELS) as ActionType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {ACTION_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Template selector */}
            {actionType === "send_template" && (
              <div className="pt-1 space-y-1.5">
                <Label
                  htmlFor="rule-template"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Template aprobado
                </Label>
                {approvedTemplates.length === 0 ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-1.5">
                    <AlertTriangle
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    No hay plantillas aprobadas por Meta. Sincronizá plantillas
                    primero.
                  </p>
                ) : (
                  <Select
                    value={selectedTemplate}
                    onValueChange={setSelectedTemplate}
                  >
                    <SelectTrigger id="rule-template">
                      <SelectValue placeholder="Elegí una plantilla" />
                    </SelectTrigger>
                    <SelectContent>
                      {approvedTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Assign agent — placeholder */}
            {actionType === "assign_agent" && (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                La asignación de agente específico estará disponible
                próximamente. La regla se guardará sin agente asignado.
              </p>
            )}

            {/* Tag input */}
            {actionType === "add_tag" && (
              <div className="pt-1 space-y-1.5">
                <Label
                  htmlFor="rule-tag"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Nombre de la etiqueta
                </Label>
                <Input
                  id="rule-tag"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder="ej. interesado, por-agendar"
                  className="h-8 text-sm"
                  aria-required="true"
                />
              </div>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Habilitada</p>
              <p className="text-xs text-muted-foreground">
                Las reglas deshabilitadas no se ejecutan
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Habilitar automatización"
            />
          </div>

          {/* Keyword and close/handoff descriptions */}
          {(actionType === "close_conversation" ||
            actionType === "handoff_human") && (
            <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {actionType === "close_conversation"
                ? "La conversación se marcará como cerrada automáticamente cuando se cumpla el disparador."
                : "Se iniciará un handoff al equipo humano cuando se cumpla el disparador."}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              type="submit"
              disabled={isLoading || !canSubmit}
              aria-busy={isLoading}
            >
              {isLoading
                ? "Guardando..."
                : isEdit
                  ? "Guardar cambios"
                  : "Crear automatización"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
