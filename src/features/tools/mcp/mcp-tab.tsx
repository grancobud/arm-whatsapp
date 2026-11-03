"use client";

/**
 * Settings › Sistemas (MCP). The business connects the MCP servers of its own
 * systems (stock, calendar, CRM…) and decides, tool by tool, what the agent
 * may use freely and what needs a person's approval.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { Plug, RefreshCw, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  addMcpServer,
  deleteMcpServer,
  inspectMcpServerAction,
  listMcpServers,
  setMcpServerEnabled,
  setMcpToolPolicy,
} from "./mcp-actions";

type Policy = "read" | "sensitive" | "off";
interface Server {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
}
interface RemoteTool {
  name: string;
  description: string;
  readOnlyHint: boolean;
  policy: Policy;
}

const POLICY_LABELS: Record<Policy, string> = {
  sensitive: "Pide aprobación",
  read: "Libre (solo consulta)",
  off: "Desactivada",
};

interface Props {
  workspaceId: string;
  canManage: boolean;
}

export function McpTab({ workspaceId, canManage }: Props) {
  const [servers, setServers] = useState<Server[]>([]);
  const [tools, setTools] = useState<Record<string, RemoteTool[] | string>>({});
  const [form, setForm] = useState({ name: "", url: "", authorization: "" });
  const [pending, startTransition] = useTransition();

  const reload = useCallback(async () => {
    const r = await listMcpServers(workspaceId);
    if (r.ok) setServers(r.data as Server[]);
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load the list on mount, like team-tab
    void reload();
  }, [reload]);

  const inspect = (id: string) =>
    startTransition(async () => {
      const r = await inspectMcpServerAction(workspaceId, id);
      setTools((t) => ({ ...t, [id]: r.ok ? (r.data as RemoteTool[]) : r.error }));
    });

  const add = () =>
    startTransition(async () => {
      const r = await addMcpServer(workspaceId, form);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Conectado: ${r.data.tools} herramientas encontradas`);
      setForm({ name: "", url: "", authorization: "" });
      await reload();
      inspect(r.data.id);
    });

  const setPolicy = (id: string, tool: string, policy: Policy) =>
    startTransition(async () => {
      const r = await setMcpToolPolicy(workspaceId, id, tool, policy);
      if (!r.ok) toast.error(r.error);
      else
        setTools((t) => ({
          ...t,
          [id]: (t[id] as RemoteTool[]).map((x) => (x.name === tool ? { ...x, policy } : x)),
        }));
    });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Plug className="h-4 w-4" aria-hidden="true" />
          Sistemas del negocio (MCP)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Conectá el servidor MCP de tu sistema de stock, agenda o CRM y el
          agente podrá consultarlo y usarlo en las charlas, sin programar nada.
          Por defecto, toda acción de un sistema externo pide aprobación de una
          persona en Revisión; vos decidís cuáles quedan libres.
        </p>
      </div>

      {servers.map((s) => {
        const list = tools[s.id];
        return (
          <div key={s.id} className="rounded-lg border border-border/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{s.url}</p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={s.enabled}
                    aria-label="Activo"
                    onCheckedChange={(v) =>
                      startTransition(async () => {
                        await setMcpServerEnabled(workspaceId, s.id, v);
                        await reload();
                      })
                    }
                  />
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => inspect(s.id)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Ver herramientas
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Quitar"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await deleteMcpServer(workspaceId, s.id);
                        await reload();
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>

            {typeof list === "string" && <p className="text-sm text-destructive">{list}</p>}
            {Array.isArray(list) && (
              <ul className="space-y-2">
                {list.map((t) => (
                  <li key={t.name} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                      {t.readOnlyHint && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          El sistema dice que solo consulta (no lo verificamos)
                        </p>
                      )}
                    </div>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={t.policy}
                      disabled={!canManage || pending}
                      aria-label={`Permiso de ${t.name}`}
                      onChange={(e) => setPolicy(s.id, t.name, e.target.value as Policy)}
                    >
                      {(Object.keys(POLICY_LABELS) as Policy[]).map((p) => (
                        <option key={p} value={p}>
                          {POLICY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {canManage ? (
        <div className="rounded-lg border border-dashed border-border/60 p-4 space-y-3">
          <p className="font-medium text-sm">Conectar un sistema</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mcp-name">Nombre</Label>
              <Input id="mcp-name" placeholder="Stock de la tienda" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mcp-url">URL del servidor MCP (https)</Label>
              <Input id="mcp-url" placeholder="https://mcp.tu-sistema.com/mcp" value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="mcp-auth">Clave de acceso (opcional, se guarda cifrada)</Label>
              <Input id="mcp-auth" type="password" placeholder="Bearer …" value={form.authorization}
                onChange={(e) => setForm({ ...form, authorization: e.target.value })} />
            </div>
          </div>
          <Button size="sm" disabled={pending || !form.name || !form.url} onClick={add}>
            Probar y conectar
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Solo un manager o admin puede conectar sistemas.</p>
      )}
    </div>
  );
}
