"use client";

import {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CUSTOM_ENDPOINT_MODELS,
  MODEL_CATALOG,
  findCatalogModel,
  findCustomEndpointModel,
  TIER_LABEL,
} from "@/features/agents/lib/model-catalog";
import { useLlmProvider } from "@/features/agents/lib/llm-provider";
import { PROVIDER_LOGOS } from "./provider-logos";

export function ModelPicker({
  value,
  onChange,
  emptyHint = "Si no elegís un modelo, se usa el del cliente.",
}: {
  value: string | null;
  onChange: (id: string) => void;
  /** Hint shown when no model is selected. */
  emptyHint?: string;
}) {
  const { custom } = useLlmProvider();
  const selected = custom
    ? (() => {
        const m = findCustomEndpointModel(value);
        return m ? { model: m } : undefined;
      })()
    : findCatalogModel(value);

  return (
    <div className="space-y-2">
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Elegí un modelo" />
        </SelectTrigger>
        <SelectContent>
          {custom &&
            CUSTOM_ENDPOINT_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          {!custom && MODEL_CATALOG.map((p) => {
            const Logo = PROVIDER_LOGOS[p.provider];
            return (
              <SelectGroup key={p.provider}>
                <SelectLabel className="flex items-center gap-2">
                  <Logo className="h-3.5 w-3.5" />
                  {p.label}
                </SelectLabel>
                {p.models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex items-center gap-2">
                      <Logo className="h-3.5 w-3.5" />
                      {m.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      {selected ? (
        <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
          <Badge variant="outline" className="shrink-0">
            {TIER_LABEL[selected.model.tier]}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {selected.model.recommendation}
          </p>
        </div>
      ) : value ? (
        <p className="text-xs text-muted-foreground px-1">
          Modelo personalizado: <span className="font-mono">{value}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground px-1">{emptyHint}</p>
      )}
    </div>
  );
}
