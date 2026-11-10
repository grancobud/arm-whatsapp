"use client";

/**
 * campaigns-view.tsx — /campanas: create a reactivation campaign for a segment
 * of consenting contacts, and follow its results. A new campaign always goes to
 * /revision first; nothing is sent from here.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Megaphone, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCampaignAction, previewSegment, setCampaignDailyLimit } from "../services/arm-actions";
import { DAILY_LIMIT_TIERS } from "../services/campaign-rules";
import type { CampaignMetrics, CampaignRow, CampaignSegment } from "../types";

export interface TemplateOption {
  id: string;
  name: string;
  language: string;
  body: string;
  variableCount: number;
}

const STAGES = [
  ["new", "Nuevo"],
  ["engaged", "Interesado"],
  ["qualified", "Calificado"],
  ["customer", "Cliente"],
  ["lost", "Perdido"],
] as const;

const STATUS_LABELS: Record<CampaignRow["status"], string> = {
  pending_approval: "Esperando aprobación",
  sending: "Enviando",
  done: "Terminada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

interface Props {
  workspaceId: string;
  canManage: boolean;
  canSetLimit: boolean;
  dailyLimit: number;
  templates: TemplateOption[];
  campaigns: CampaignRow[];
  metrics: CampaignMetrics[];
}

function pct(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

export function CampaignsView({
  workspaceId,
  canManage,
  canSetLimit,
  dailyLimit,
  templates,
  campaigns,
  metrics,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function changeLimit(value: string) {
    startTransition(async () => {
      const res = await setCampaignDailyLimit(workspaceId, Number(value));
      if (res.ok) toast.success("Tope diario actualizado");
      else toast.error(res.error);
    });
  }
  const [name, setName] = useState("");
  const [stages, setStages] = useState<string[]>(["customer"]);
  const [tags, setTags] = useState("");
  const [inactiveDays, setInactiveDays] = useState("60");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    count: number;
    sample: string[];
  } | null>(null);

  const template = templates.find((t) => t.id === templateId);

  function buildSegment(): CampaignSegment {
    const days = parseInt(inactiveDays, 10);
    return {
      stages: stages.length > 0 ? stages : undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      inactive_days: Number.isFinite(days) && days > 0 ? days : undefined,
    };
  }

  function toggleStage(stage: string, on: boolean) {
    setStages((prev) =>
      on ? [...prev, stage] : prev.filter((s) => s !== stage),
    );
    setPreview(null);
  }

  function onPreview() {
    startTransition(async () => {
      const res = await previewSegment(workspaceId, buildSegment());
      if (res.ok) setPreview(res.data);
      else toast.error(res.error);
    });
  }

  function onCreate() {
    startTransition(async () => {
      const res = await createCampaignAction({
        workspaceId,
        name,
        segment: buildSegment(),
        templateId,
        variables,
      });
      if (res.ok) {
        toast.success(
          `Campaña creada para ${res.data.recipientCount} contactos. Aprobala en Revisión.`,
        );
        setName("");
        setPreview(null);
      } else {
        toast.error(res.error);
      }
    });
  }

  const metricsById = new Map(metrics.map((m) => [m.campaignId, m]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Megaphone className="h-5 w-5" aria-hidden="true" />
          Campañas de reactivación
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Solo llegan a contactos que aceptaron recibir promociones (se carga en
          Ver contacto; escribirle al negocio no alcanza), con una plantilla
          aprobada por Meta. Cada campaña pasa por{" "}
          <Link href="/revision" className="underline underline-offset-2">
            Revisión
          </Link>{" "}
          antes de enviarse. Cuando el cliente responde, el agente sigue la
          charla.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          La plantilla tiene que decir cómo darse de baja. Para cuidar el número,
          los envíos arrancan de a poco: 50 personas el primer día, 100 el
          segundo, y así hasta {dailyLimit.toLocaleString("es-AR")} por día; el
          resto sale en los días siguientes,
          siempre de día. Si fallan muchos envíos, si 1 de cada 20 personas pide
          no recibir más o si Meta pausa la plantilla, la campaña se frena sola.
        </p>
      </div>

      {canSetLimit && (
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="c-limit">Tope de envíos por día</Label>
          <Select value={String(dailyLimit)} onValueChange={changeLimit} disabled={isPending}>
            <SelectTrigger id="c-limit" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAILY_LIMIT_TIERS.map((tier) => (
                <SelectItem key={tier} value={String(tier)}>
                  {tier.toLocaleString("es-AR")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="basis-full text-xs text-muted-foreground">
            Dejalo en 250 salvo que YCloud o Meta te muestren un nivel más alto
            para tu número. Subirlo de más no hace que lleguen más mensajes:
            WhatsApp rechaza el excedente y la campaña se frena.
          </p>
        </div>
      )}

      {canManage && (
        <section className="rounded-lg border border-border/60 bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Nueva campaña</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Nombre</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Clientes sin compra en 60 días"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plantilla aprobada</Label>
              <Select
                value={templateId}
                onValueChange={(v) => {
                  setTemplateId(v);
                  const t = templates.find((x) => x.id === v);
                  setVariables(Array(t?.variableCount ?? 0).fill(""));
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      templates.length === 0
                        ? "No hay plantillas aprobadas"
                        : "Elegí una plantilla"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {template && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap rounded bg-muted/40 p-2">
                {template.body}
              </p>
              {variables.map((v, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`c-var-${i}`}>{`Variable {{${i + 1}}}`}</Label>
                  <Input
                    id={`c-var-${i}`}
                    value={v}
                    onChange={(e) =>
                      setVariables((prev) =>
                        prev.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>Segmento</Label>
            <div className="flex flex-wrap gap-4">
              {STAGES.map(([value, label]) => (
                <label
                  key={value}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={stages.includes(value)}
                    onCheckedChange={(on) => toggleStage(value, on === true)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="c-tags" className="text-xs">
                  Etiquetas (separadas por coma, opcional)
                </Label>
                <Input
                  id="c-tags"
                  value={tags}
                  onChange={(e) => {
                    setTags(e.target.value);
                    setPreview(null);
                  }}
                  placeholder="vip, mayorista"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-days" className="text-xs">
                  Sin mensajes hace al menos (días)
                </Label>
                <Input
                  id="c-days"
                  type="number"
                  min={0}
                  value={inactiveDays}
                  onChange={(e) => {
                    setInactiveDays(e.target.value);
                    setPreview(null);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onPreview} disabled={isPending}>
              <Users className="h-4 w-4 mr-1" /> Ver a quiénes llega
            </Button>
            <Button
              onClick={onCreate}
              disabled={isPending || !name.trim() || !templateId}
            >
              Crear y mandar a Revisión
            </Button>
            {preview && (
              <span className="text-sm text-muted-foreground">
                {preview.count} contactos que aceptaron promociones
                {preview.sample.length > 0 &&
                  ` (ej: ${preview.sample.join(", ")})`}
              </span>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Campañas</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay campañas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/50">
                  <th className="text-left font-medium px-4 py-2">Campaña</th>
                  <th className="text-left font-medium px-4 py-2">Estado</th>
                  <th className="text-right font-medium px-4 py-2">Enviados</th>
                  <th className="text-right font-medium px-4 py-2">
                    Respondieron
                  </th>
                  <th className="text-right font-medium px-4 py-2">Bajas</th>
                  <th className="text-right font-medium px-4 py-2">Fallidos</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const m = metricsById.get(c.id);
                  return (
                    <tr key={c.id} className="border-b border-border/30">
                      <td className="px-4 py-2">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.template_name}
                        </p>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">
                          {STATUS_LABELS[c.status]}
                        </Badge>
                        {m && m.pending > 0 && c.status === "sending" && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {m.pending} en cola
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {m?.sent ?? 0} / {c.recipient_count}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {m?.replied ?? 0}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({pct(m?.replied ?? 0, m?.sent ?? 0)})
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {m?.optedOut ?? 0}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {m?.failed ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
