"use client";

/**
 * crm-panel.tsx — Collapsible CRM side panel for contact details.
 * Shows contact info, stage, tags, opt-in status with inline editing.
 */

import { useState, useTransition, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { User, RefreshCw, Save, ChevronDown, ChevronUp, X, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateContact, syncContactHL } from "../services/contact-actions";
import type { ContactRow } from "@/features/inbox/types";
import { ClaimsSection } from "@/features/arm/components/claims-section";
import { FollowUpsSection } from "@/features/arm/components/follow-ups-section";
import { ContactChangesSection } from "@/features/arm/components/contact-changes-section";
import { RelationshipBadge } from "@/features/arm/components/relationship-badge";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type Stage = "new" | "engaged" | "qualified" | "customer" | "lost";

const STAGE_LABELS: Record<Stage, string> = {
  new: "Nuevo",
  engaged: "Interesado",
  qualified: "Calificado",
  customer: "Cliente",
  lost: "Perdido",
};

interface CrmPanelProps {
  contact: ContactRow;
  conversationId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Avatar helper
// ──────────────────────────────────────────────────────────────────────────────

function Initials({ name }: { name: string | null }) {
  const letters = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("")
    : "?";

  return (
    <div className="h-10 w-10 rounded-full bg-[hsl(var(--electric-lime)/0.15)] border border-[hsl(var(--electric-lime)/0.3)] flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] font-mono">
        {letters}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// CrmPanel
// ──────────────────────────────────────────────────────────────────────────────

export function CrmPanel({
  contact,
  conversationId: _conversationId,
}: CrmPanelProps) {
  const router = useRouter();
  const [erasing, setErasing] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Local editable state
  const [name, setName] = useState(contact.name ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [stage, setStage] = useState<Stage>(
    (contact.stage as Stage | null) ?? "new",
  );
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [optIn, setOptIn] = useState(contact.opt_in);
  const [marketingOptIn, setMarketingOptIn] = useState(contact.marketing_opt_in ?? false);
  const [marketingSource, setMarketingSource] = useState(contact.marketing_opt_in_source ?? "");

  // Section collapse
  const [contactOpen, setContactOpen] = useState(true);
  const [crmOpen, setCrmOpen] = useState(true);

  // ── Tag helpers ──────────────────────────────────────────────────────────────

  function addTag() {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  function handleSave() {
    startTransition(async () => {
      const result = await updateContact(contact.id, {
        name: name || undefined,
        email: email || undefined,
        stage,
        tags,
        opt_in: optIn,
        // Only when it changed: saving other fields must not rewrite the date.
        ...(marketingOptIn !== (contact.marketing_opt_in ?? false)
          ? {
              marketing_opt_in: marketingOptIn,
              marketing_opt_in_source: marketingSource.trim() || undefined,
            }
          : {}),
      });

      if (result.ok) {
        toast.success("Contacto actualizado");
      } else {
        toast.error(result.error ?? "Error al guardar");
      }
    });
  }

  // ── HL Sync ──────────────────────────────────────────────────────────────────

  async function handleErase() {
    const confirmed = window.confirm(
      "¿Borrar todos los datos de este contacto? Se borran sus conversaciones, memoria, turnos y archivos. No se puede deshacer. Si está en HighLevel u otro sistema, también hay que borrarlo ahí.",
    );
    if (!confirmed) return;
    setErasing(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          res.status === 403
            ? "Solo un manager o admin puede borrar un contacto"
            : (json.error ?? "No se pudo borrar el contacto"),
        );
        return;
      }
      toast.success("Contacto borrado");
      router.push("/inbox");
      router.refresh();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setErasing(false);
    }
  }

  function handleSyncHL() {
    startTransition(async () => {
      const result = await syncContactHL(contact.id, contact.workspace_id);

      if (result.ok) {
        toast.success(`Sincronizado con HighLevel (ID: ${result.data.hl_id})`);
      } else {
        toast.error(result.error ?? "Error al sincronizar");
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <aside className="w-full md:w-72 shrink-0 flex flex-col gap-0 border-l border-border/50 glass overflow-y-auto text-sm">
      {/* ── Section: Contact info ── */}
      <section>
        <button
          type="button"
          onClick={() => setContactOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
        >
          <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider">
            Contacto
          </span>
          {contactOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {contactOpen && (
          <div className="px-4 py-3 space-y-3">
            {/* Avatar + phone */}
            <div className="flex items-center gap-3">
              <Initials name={name || contact.name} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {contact.phone}
                </p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Nombre
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sin nombre"
                className="h-7 text-xs"
              />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Email
              </Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@ejemplo.com"
                type="email"
                className="h-7 text-xs"
              />
            </div>

            {/* Opt-in switch */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Puede recibir mensajes
              </Label>
              <Switch
                checked={optIn}
                onCheckedChange={(on) => {
                  setOptIn(on);
                  if (!on) setMarketingOptIn(false);
                }}
                aria-label="Puede recibir mensajes"
              />
            </div>

            {/* Writing to the business isn't accepting promotions: a person records it. */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Aceptó promociones
              </Label>
              <Switch
                checked={marketingOptIn}
                disabled={!optIn}
                onCheckedChange={setMarketingOptIn}
                aria-label="Aceptó recibir campañas y promociones"
              />
            </div>

            {/* Consent evidence — required to send campaigns lawfully */}
            {marketingOptIn && (
              <div className="space-y-1">
                <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                  Cómo aceptó (obligatorio)
                </Label>
                <Input
                  value={marketingSource}
                  onChange={(e) => setMarketingSource(e.target.value)}
                  placeholder="Ej: formulario web, en el local…"
                  className="h-7 text-xs"
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Section: CRM ── */}
      <section>
        <button
          type="button"
          onClick={() => setCrmOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
        >
          <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider">
            CRM
          </span>
          {crmOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {crmOpen && (
          <div className="px-4 py-3 space-y-3">
            {/* Stage */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Etapa
              </Label>
              <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STAGE_LABELS) as Stage[]).map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                Etiquetas
              </Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] pr-1 gap-1"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={`Eliminar etiqueta ${tag}`}
                        className="hover:text-destructive transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder="Agregar etiqueta..."
                className="h-7 text-xs"
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Section: ARM memory ── */}
      <RelationshipBadge contactId={contact.id} />
      <ClaimsSection contactId={contact.id} />
      <FollowUpsSection contactId={contact.id} />
      <ContactChangesSection contactId={contact.id} />

      {/* ── Actions ── */}
      <div className="px-4 py-3 border-t border-border/40 flex flex-col gap-2 mt-auto">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          className="w-full h-7 text-xs gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncHL}
          disabled={isPending}
          className="w-full h-7 text-xs gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Sync HighLevel
        </Button>
        <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
          <a href={`/api/contacts/${contact.id}/export`} download>
            <Download className="h-3.5 w-3.5" />
            Bajar sus datos
          </a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleErase}
          disabled={erasing}
          className="w-full h-7 text-xs gap-1.5 text-destructive border-destructive/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {erasing ? "Borrando..." : "Borrar todos sus datos"}
        </Button>
      </div>

      {/* Opt-out warning */}
      {!optIn && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
          <p className="text-[10px] text-destructive leading-snug">
            <strong>Opt-out activo.</strong> No se enviarán mensajes a este
            contacto.
          </p>
        </div>
      )}
    </aside>
  );
}

// Re-export User icon for the toggle button in chat-thread
export { User };
