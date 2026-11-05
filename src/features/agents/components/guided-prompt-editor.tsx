"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AGENT_TYPE_META } from "@/features/agents/lib/agent-meta";
import type { AgentDto } from "@/features/agents/types";

interface Props {
  workspaceId: string;
  agent: AgentDto;
  onPublished: (body: string) => void;
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function GuidedPromptEditor({ workspaceId, agent, onPublished }: Props) {
  const meta = AGENT_TYPE_META[agent.type];
  const router = useRouter();
  const [body, setBody] = useState(agent.promptBody);
  const [rules, setRules] = useState(
    (agent.promptGuardrails?.rules ?? []).join("\n"),
  );
  const [restrictions, setRestrictions] = useState(
    (agent.promptGuardrails?.restrictions ?? []).join("\n"),
  );
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function createDraft(): Promise<{
    promptId: string;
    versionId: string;
  } | null> {
    const res = await fetch(`/api/workspace/${workspaceId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptName: `Agente ${agent.type}`,
        scope: "mode",
        scopeRef: agent.type,
        body,
        guardrails: {
          rules: linesToArray(rules),
          restrictions: linesToArray(restrictions),
        },
      }),
    });
    const json = (await res.json()) as {
      data?: { promptId: string; versionId: string };
      error?: unknown;
    };
    if (!res.ok || !json.data) {
      toast.error(
        typeof json.error === "string" ? json.error : "Error al guardar",
      );
      return null;
    }
    return json.data;
  }

  async function handleSaveDraft() {
    if (!body.trim()) {
      toast.error("El prompt no puede estar vacío");
      return;
    }
    setSavingDraft(true);
    try {
      const draft = await createDraft();
      if (draft) toast.success("Borrador guardado");
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handlePublish() {
    if (!body.trim()) {
      toast.error("El prompt no puede estar vacío");
      return;
    }
    setPublishing(true);
    try {
      const draft = await createDraft();
      if (!draft) return;
      const res = await fetch(`/api/workspace/${workspaceId}/prompts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: draft.promptId,
          versionId: draft.versionId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "Error al publicar");
        return;
      }
      // Point the agent at the just-published prompt so it's the one read back
      // (listAgents reads promptBody via agent.prompt_id). Without this the
      // editor reverts to the seeded prompt when re-mounted.
      await fetch(`/api/workspace/${workspaceId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, promptId: draft.promptId }),
      });
      toast.success("Prompt publicado");
      onPublished(body);
      router.refresh();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Guía para {meta.label}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {meta.promptGuidance.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-prompt">Instrucciones del agente</Label>
        <Textarea
          id="agent-prompt"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="Describe cómo debe comportarse el agente..."
        />
        <p className="text-[11px] text-muted-foreground">
          Variables disponibles:{" "}
          <span className="font-mono">{"{{business_name}}"}</span>,{" "}
          <span className="font-mono">{"{{agent_name}}"}</span>,{" "}
          <span className="font-mono">{"{{contact.name}}"}</span>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-rules">Reglas — qué SÍ debe hacer</Label>
        <Textarea
          id="agent-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
          placeholder={
            "Una regla por línea. Ej.:\nConfirmá siempre el nombre del cliente\nOfrecé sacar un turno al final"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Una por línea. Se inyectan como reglas estrictas que el agente debe
          cumplir siempre.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-restrictions">
          Restricciones — qué NUNCA debe hacer
        </Label>
        <Textarea
          id="agent-restrictions"
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
          rows={3}
          placeholder={
            "Una restricción por línea. Ej.:\nNo inventes precios ni promociones\nNo menciones a la competencia\nNo uses dobles asteriscos (**)"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Una por línea. El agente tiene prohibido hacer o decir esto.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={savingDraft || publishing}
          aria-busy={savingDraft}
        >
          {savingDraft ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Guardar borrador
        </Button>
        <Button
          onClick={handlePublish}
          disabled={publishing || savingDraft}
          aria-busy={publishing}
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Publicar
        </Button>
      </div>
    </div>
  );
}
