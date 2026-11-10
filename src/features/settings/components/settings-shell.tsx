"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BusinessInfoForm } from "./business-info-form";
import { ToolsCatalog } from "./tools-catalog";
import { IntegrationsTab } from "./integrations-tab";
import { TeamTab } from "./team-tab";
import { TemplatesTab } from "./templates-tab";
import { AutomationsTab } from "./automations-tab";
import { KbTab } from "./kb-tab";
import { DataExportTab } from "./data-export-tab";
import { McpTab } from "@/features/tools/mcp/mcp-tab";
import { AgentsTab } from "@/features/agents/components/agents-tab";
import type { AgentDto } from "@/features/agents/types";
import type { SettingsTab } from "../settings-tabs";
import type { JevSettings } from "@/features/jev-judge/components/jev-panel";
import { LlmProviderProvider } from "@/features/agents/lib/llm-provider";

interface ToolItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sensitivity: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

interface Props {
  workspaceId: string;
  role: string;
  initialTab: SettingsTab;
  initialBusinessInfo: Record<string, unknown> | null;
  initialTools: ToolItem[];
  initialIntegrations: unknown[];
  initialTemplates?: unknown[];
  initialAgents?: AgentDto[];
  jev: JevSettings;
  /** The server uses its own LLM endpoint (LLM_BASE_URL), not OpenRouter. */
  llmCustom: boolean;
}

export function SettingsShell({
  workspaceId,
  role,
  initialTab,
  initialBusinessInfo,
  initialTools,
  initialIntegrations,
  initialTemplates = [],
  initialAgents = [],
  jev,
  llmCustom,
}: Props) {
  const biForForm = initialBusinessInfo as {
    structured: Record<string, unknown>;
    free_text: string | null;
  } | null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-xl font-semibold text-foreground mb-6">
        Configuración
      </h1>

      <LlmProviderProvider custom={llmCustom}>
      <Tabs defaultValue={initialTab}>
        {/* On a phone the tabs wrap, so none stays hidden past the edge; wider
            screens keep one row and scroll within its own track. */}
        <div className="no-scrollbar mb-6 -mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-max sm:flex-nowrap">
            <TabsTrigger value="agentes">Agentes</TabsTrigger>
            <TabsTrigger value="integraciones">Integraciones</TabsTrigger>
            <TabsTrigger value="negocio">Negocio</TabsTrigger>
            <TabsTrigger value="tools">Herramientas</TabsTrigger>
            <TabsTrigger value="sistemas">Sistemas</TabsTrigger>
            <TabsTrigger value="templates">Plantillas</TabsTrigger>
            <TabsTrigger value="knowledge-base">Base de conocimiento</TabsTrigger>
            <TabsTrigger value="equipo">Equipo</TabsTrigger>
            <TabsTrigger value="automatizaciones">Automatizaciones</TabsTrigger>
            <TabsTrigger value="datos">Datos</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agentes">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <AgentsTab
              workspaceId={workspaceId}
              initialAgents={initialAgents}
              jev={jev}
              canManage={role === "admin" || role === "manager"}
            />
          </div>
        </TabsContent>

        <TabsContent value="integraciones">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <IntegrationsTab
              workspaceId={workspaceId}
              initialIntegrations={initialIntegrations}
            />
          </div>
        </TabsContent>

        <TabsContent value="negocio">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <BusinessInfoForm workspaceId={workspaceId} initial={biForForm} />
          </div>
        </TabsContent>

        <TabsContent value="tools">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <ToolsCatalog
              workspaceId={workspaceId}
              initialTools={initialTools}
            />
          </div>
        </TabsContent>

        <TabsContent value="sistemas">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <McpTab
              workspaceId={workspaceId}
              canManage={role === "admin" || role === "manager"}
            />
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="p-6 rounded-lg border border-border/60 bg-card">
            <TemplatesTab
              workspaceId={workspaceId}
              initialTemplates={initialTemplates}
            />
          </div>
        </TabsContent>
        <TabsContent value="knowledge-base">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <KbTab workspaceId={workspaceId} />
          </div>
        </TabsContent>

        <TabsContent value="equipo">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <TeamTab workspaceId={workspaceId} />
          </div>
        </TabsContent>

        <TabsContent value="automatizaciones">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <AutomationsTab workspaceId={workspaceId} />
          </div>
        </TabsContent>

        <TabsContent value="datos">
          <div className="p-4 sm:p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <DataExportTab
              workspaceId={workspaceId}
              canExport={role === "admin" || role === "manager"}
            />
          </div>
        </TabsContent>
      </Tabs>
      </LlmProviderProvider>
    </div>
  );
}
