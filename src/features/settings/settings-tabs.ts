/** Tabs of /settings, also usable as a link: /settings?tab=datos. */
export const SETTINGS_TABS = [
  "agentes",
  "integraciones",
  "negocio",
  "tools",
  "sistemas",
  "templates",
  "knowledge-base",
  "equipo",
  "automatizaciones",
  "datos",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function readSettingsTab(value: string | undefined): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? "agentes";
}
