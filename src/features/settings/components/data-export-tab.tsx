"use client";

/**
 * data-export-tab.tsx — Settings › Datos. The workspace's records are its own:
 * one click downloads them. Credentials are never included.
 */

import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  workspaceId: string;
  canExport: boolean;
}

export function DataExportTab({ workspaceId, canExport }: Props) {
  const base = `/api/workspace/${workspaceId}/export`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          Exportar datos
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Los datos de este cliente son tuyos. Bajalos cuando quieras para
          tener una copia o llevarlos a otro sistema. Las claves y credenciales
          de las integraciones nunca se incluyen.
        </p>
      </div>

      {!canExport ? (
        <p className="text-sm text-muted-foreground">
          Solo un manager o admin puede exportar.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 p-4 space-y-3">
            <p className="font-medium flex items-center gap-2">
              <FileJson className="h-4 w-4" aria-hidden="true" />
              Todo (JSON)
            </p>
            <p className="text-xs text-muted-foreground">
              Contactos con su consentimiento, lo que sabemos de cada uno (con
              sus fuentes), conversaciones, mensajes, campañas y decisiones de
              Revisión.
            </p>
            <Button asChild size="sm">
              <a href={base} download>
                Descargar JSON
              </a>
            </Button>
          </div>

          <div className="rounded-lg border border-border/60 p-4 space-y-3">
            <p className="font-medium flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Contactos (CSV)
            </p>
            <p className="text-xs text-muted-foreground">
              Para abrir en Excel o Google Sheets: teléfono, nombre, etapa,
              etiquetas y consentimiento.
            </p>
            <Button asChild size="sm" variant="outline">
              <a href={`${base}?format=csv`} download>
                Descargar CSV
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
