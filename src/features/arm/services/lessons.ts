// Learning from corrections. When a person rejects something the agent
// proposed or corrects one of its replies, they can say what it should have
// done. That becomes a rule of the workspace and goes into the agent's prompt
// ("Correcciones del equipo"), so the same mistake doesn't happen twice.
//
// formatLessonsContext is pure (evals/correcciones).

import { createClient as createSbClient } from "@supabase/supabase-js";

/** Newest rules win; the prompt stays short. */
export const MAX_LESSONS_IN_PROMPT = 15;

export interface LessonRow {
  lesson: string;
  example: string | null;
  source: string;
}

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function formatLessonsContext(lessons: LessonRow[]): string {
  const rows = lessons.filter((l) => l.lesson.trim()).slice(0, MAX_LESSONS_IN_PROMPT);
  if (rows.length === 0) return "";
  const lines = rows.map((l) => {
    const rule = `- ${oneLine(l.lesson, 300)}`;
    if (!l.example) return rule;
    const what = l.source === "rejected_proposal" ? "Habías propuesto" : "Habías respondido";
    return `${rule} (${what}: «${oneLine(l.example, 160)}»)`;
  });
  return [
    "## Correcciones del equipo",
    "Las escribió el equipo del negocio después de revisar lo que hiciste. Seguílas: tienen prioridad sobre tu criterio, pero no sobre las reglas estrictas.",
    ...lines,
  ].join("\n");
}

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Active lessons of a workspace, as a prompt block ("" if none). Never throws. */
export async function getLessonsContext(workspaceId: string): Promise<string> {
  try {
    const { data, error } = await svc()
      .from("agent_lessons")
      .select("lesson, example, source")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(MAX_LESSONS_IN_PROMPT);
    if (error) return "";
    return formatLessonsContext((data ?? []) as LessonRow[]);
  } catch {
    return "";
  }
}
