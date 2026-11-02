"use client";

/**
 * review-queue.tsx — /revision: what the agent proposed and the campaigns that
 * wait for a person's OK. Nothing here runs until someone approves it.
 */

import { useTransition } from "react";
import Link from "next/link";
import { Check, Megaphone, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decideCampaign, decideProposal } from "../services/arm-actions";
import type { CampaignRow, ProposalRow } from "../types";

const PROPOSAL_STATUS: Record<ProposalRow["status"], string> = {
  pending: "Pendiente",
  executed: "Ejecutada",
  failed: "Falló",
  rejected: "Rechazada",
};

interface Props {
  proposals: ProposalRow[];
  history: ProposalRow[];
  campaigns: CampaignRow[];
  canDecide: boolean;
  usdPerMessage: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function ReviewQueue({
  proposals,
  history,
  campaigns,
  canDecide,
  usdPerMessage,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function onProposal(id: string, approve: boolean) {
    startTransition(async () => {
      const res = await decideProposal(id, approve);
      if (res.ok) toast.success(approve ? "Aprobada y ejecutada" : "Rechazada");
      else toast.error(res.error);
    });
  }

  function onCampaign(id: string, approve: boolean) {
    startTransition(async () => {
      const res = await decideCampaign(id, approve);
      if (res.ok)
        toast.success(
          approve
            ? "Campaña aprobada: se envía por tandas cada minuto"
            : "Campaña rechazada",
        );
      else toast.error(res.error);
    });
  }

  const empty = proposals.length === 0 && campaigns.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-8">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">
          Revisión
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lo que el agente quiere hacer y las campañas que esperan tu
          aprobación. Nada de esto se ejecuta sin que alguien lo apruebe.
          {!canDecide && " Solo un manager o admin puede decidir."}
        </p>
      </div>

      {empty && (
        <div className="rounded-lg border border-border/60 bg-card p-6 text-sm text-muted-foreground">
          No hay nada pendiente.
        </div>
      )}

      {campaigns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Megaphone className="h-4 w-4" aria-hidden="true" />
            Campañas por aprobar
          </h2>
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-border/60 bg-card p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{c.name}</p>
                <span className="text-xs text-muted-foreground">
                  {formatDate(c.created_at)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Plantilla <span className="font-mono">{c.template_name}</span> a{" "}
                <strong className="text-foreground">
                  {c.recipient_count} contactos
                </strong>{" "}
                con consentimiento. Costo estimado en Meta: ~USD{" "}
                {(c.recipient_count * usdPerMessage).toFixed(2)}.
              </p>
              {canDecide && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => onCampaign(c.id, true)}
                    disabled={isPending}
                  >
                    <Check className="h-4 w-4 mr-1" /> Aprobar y enviar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCampaign(c.id, false)}
                    disabled={isPending}
                  >
                    <X className="h-4 w-4 mr-1" /> Rechazar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {proposals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4" aria-hidden="true" />
            Acciones propuestas por el agente
          </h2>
          {proposals.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-border/60 bg-card p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm">{p.tool_name}</p>
                <span className="text-xs text-muted-foreground">
                  {formatDate(p.created_at)}
                </span>
              </div>
              <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(p.args, null, 2)}
              </pre>
              <div className="flex flex-wrap gap-2 items-center">
                {p.conversation_id && (
                  <Link
                    href={`/inbox/${p.conversation_id}`}
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    Ver conversación
                  </Link>
                )}
                {canDecide && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => onProposal(p.id, true)}
                      disabled={isPending}
                    >
                      <Check className="h-4 w-4 mr-1" /> Aprobar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onProposal(p.id, false)}
                      disabled={isPending}
                    >
                      <X className="h-4 w-4 mr-1" /> Rechazar
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Decididas recientemente
          </h2>
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60 bg-card">
            {history.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
              >
                <span className="font-mono">{p.tool_name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">{PROPOSAL_STATUS[p.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {p.decided_at ? formatDate(p.decided_at) : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
