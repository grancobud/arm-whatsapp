// Graduated autonomy: per action, the owner decides whether the agent does it
// on its own or proposes it and a person approves (in Revisión). The default
// comes from the tool itself (sensitive → propose). And the agent earns trust:
// after APPROVALS_TO_PROMOTE approvals in a row with no rejection, the screen
// suggests letting it act alone. It never promotes itself: a person decides.
//
// Stored in workspaces.settings.tool_autonomy = { [toolKey]: "auto" | "propose" }.
// Pure module, tested in evals/autonomia.

import type { ToolSensitivity } from "../core/tool";

export type AutonomyMode = "auto" | "propose";

export const APPROVALS_TO_PROMOTE = 10;

export function defaultMode(sensitivity: ToolSensitivity): AutonomyMode {
  return sensitivity === "sensitive" ? "propose" : "auto";
}

/** The sensitivity the registry should apply given the owner's choice. */
export function effectiveSensitivity(
  sensitivity: ToolSensitivity,
  mode: AutonomyMode | undefined,
): ToolSensitivity {
  if (mode === "propose") return "sensitive";
  // "Do it alone" lifts the approval gate but keeps write semantics (no retries).
  if (mode === "auto" && sensitivity === "sensitive") return "write";
  return sensitivity;
}

export function parseAutonomy(settings: unknown): Record<string, AutonomyMode> {
  const raw = (settings as { tool_autonomy?: unknown } | null)?.tool_autonomy;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, AutonomyMode> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "auto" || v === "propose") out[k] = v;
  }
  return out;
}

export interface TrackRecord {
  approved: number;
  rejected: number;
  /** Approvals since the last rejection (newest first). */
  streak: number;
  suggestAuto: boolean;
}

/**
 * Track record from proposal statuses, newest first. executed/failed mean a
 * person approved it (failed = it then errored, not the agent's judgment).
 */
export function trackRecord(statusesNewestFirst: string[], mode: AutonomyMode): TrackRecord {
  const decided = statusesNewestFirst.filter((s) => s !== "pending");
  const isApproval = (s: string) => s === "executed" || s === "failed";
  let streak = 0;
  for (const s of decided) {
    if (!isApproval(s)) break;
    streak++;
  }
  return {
    approved: decided.filter(isApproval).length,
    rejected: decided.filter((s) => s === "rejected").length,
    streak,
    suggestAuto: mode === "propose" && streak >= APPROVALS_TO_PROMOTE,
  };
}
