// ARM: data export — the workspace's records belong to the workspace.
//
//   GET /api/workspace/:id/export               → everything, one JSON file
//   GET /api/workspace/:id/export?format=csv    → contacts only, CSV
//
// Admins and managers only. Integration credentials, tool credentials and OAuth
// tokens are never part of an export. Reads page through each table so the
// PostgREST row cap never truncates the file silently.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const PAGE_SIZE = 1000;
// A hard ceiling per table keeps one export inside the function time limit.
const MAX_ROWS_PER_TABLE = 50_000;

// Explicit column lists: a new sensitive column must be opted in, not out.
const TABLES = {
  contacts:
    "id, phone, name, email, source, stage, tags, custom_fields, opt_in, opt_in_at, opt_in_source, opt_out_at, created_at, updated_at",
  contact_claims:
    "id, contact_id, kind, text, source_message_id, quote, author, status, created_at",
  conversations:
    "id, contact_id, channel, state, last_message_at, created_at",
  messages:
    "id, conversation_id, direction, type, body, status, created_at",
  campaigns:
    "id, name, segment, template_name, template_language, variables, status, recipient_count, decided_at, created_at",
  campaign_recipients:
    "id, campaign_id, contact_id, conversation_id, status, error, sent_at, created_at",
  agent_proposals:
    "id, conversation_id, contact_id, tool_name, args, status, result, decided_at, created_at",
} as const;

type TableName = keyof typeof TABLES;

async function readAll(
  table: TableName,
  workspaceId: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const supabase = svc();
  // Plain string: the literal union of all column lists is too complex for
  // supabase-js's select() type inference.
  const columns: string = TABLES[table];
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table as string)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value)
    ? value.join("; ")
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  // Neutralize spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(","));
  }
  // BOM so Excel opens accents correctly.
  return "﻿" + lines.join("\r\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const stamp = new Date().toISOString().slice(0, 10);
  const format = req.nextUrl.searchParams.get("format");

  try {
    if (format === "csv") {
      const { rows } = await readAll("contacts", workspaceId);
      const columns = TABLES.contacts.split(",").map((c) => c.trim());
      return new NextResponse(toCsv(rows, columns), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="contactos-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { data: workspace } = await svc()
      .from("workspaces")
      .select("id, name, created_at")
      .eq("id", workspaceId)
      .maybeSingle();

    const data: Record<string, Record<string, unknown>[]> = {};
    const truncated: string[] = [];
    for (const table of Object.keys(TABLES) as TableName[]) {
      const result = await readAll(table, workspaceId);
      data[table] = result.rows;
      if (result.truncated) truncated.push(table);
    }

    const body = JSON.stringify(
      {
        format: "agente-wa-export",
        version: 1,
        exported_at: new Date().toISOString(),
        exported_by: auth.userId,
        workspace,
        truncated_tables: truncated,
        counts: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v.length]),
        ),
        data,
      },
      null,
      2,
    );

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="export-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export] failed:", err);
    return NextResponse.json(
      { error: "No se pudo generar la exportación" },
      { status: 500 },
    );
  }
}
