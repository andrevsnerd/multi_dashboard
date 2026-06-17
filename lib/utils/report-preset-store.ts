import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import type { ReportPresetColumn } from "@/lib/reports/types";
import type { ReportPreset, ReportPresetInput } from "@/lib/types/report-preset";

export type { ReportPreset, ReportPresetInput } from "@/lib/types/report-preset";

/**
 * Persistência dos presets de colunas do Gerador de Relatórios.
 * Mesmo padrão de `compra-salva-store.ts`: arquivo JSON em `data/` como
 * fallback e Postgres/Neon quando `DATABASE_URL` está configurado.
 * Presets são COMPARTILHADOS por (reportType, companyKey).
 */
const FILE_PATH = path.join(process.cwd(), "data", "report-presets.json");

let tableChecked = false;

async function ensureDataFile() {
  const dir = path.join(process.cwd(), "data");
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify([]), "utf-8");
  }
}

async function ensureTable() {
  if (tableChecked) return;
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS report_presets (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      company_key TEXT NOT NULL,
      name TEXT NOT NULL,
      columns JSONB NOT NULL,
      sort_by TEXT,
      sort_dir TEXT,
      owner_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

function normalizeColumns(columns: unknown): ReportPresetColumn[] {
  if (!Array.isArray(columns)) return [];
  return columns
    .map((c) => ({
      key: String((c as ReportPresetColumn)?.key ?? "").trim(),
      label: String((c as ReportPresetColumn)?.label ?? "").trim(),
    }))
    .filter((c) => c.key.length > 0);
}

function rowToPreset(row: {
  id: string;
  report_type: string;
  company_key: string;
  name: string;
  columns: unknown;
  sort_by: string | null;
  sort_dir: string | null;
  owner_username: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}): ReportPreset {
  return {
    id: row.id,
    reportType: row.report_type,
    companyKey: row.company_key,
    name: row.name,
    columns: normalizeColumns(row.columns),
    sortBy: row.sort_by,
    sortDir: (row.sort_dir as ReportPreset["sortDir"]) ?? null,
    ownerUsername: row.owner_username,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readFileAll(): Promise<ReportPreset[]> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as ReportPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(rows: ReportPreset[]) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), "utf-8");
}

export async function listReportPresets(
  reportType: string,
  companyKey: string
): Promise<ReportPreset[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, report_type, company_key, name, columns, sort_by, sort_dir,
             owner_username, created_at, updated_at
      FROM report_presets
      WHERE report_type = ${reportType} AND company_key = ${companyKey}
      ORDER BY name ASC
    `;
    return rows.map((r) => rowToPreset(r as never));
  }

  const all = await readFileAll();
  return all
    .filter((p) => p.reportType === reportType && p.companyKey === companyKey)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createReportPreset(
  input: ReportPresetInput
): Promise<ReportPreset> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const preset: ReportPreset = {
    id,
    reportType: input.reportType,
    companyKey: input.companyKey,
    name: input.name.trim(),
    columns: normalizeColumns(input.columns),
    sortBy: input.sortBy ?? null,
    sortDir: input.sortDir ?? null,
    ownerUsername: input.ownerUsername ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO report_presets (
        id, report_type, company_key, name, columns, sort_by, sort_dir,
        owner_username, created_at, updated_at
      ) VALUES (
        ${preset.id}, ${preset.reportType}, ${preset.companyKey}, ${preset.name},
        ${JSON.stringify(preset.columns)}::jsonb, ${preset.sortBy}, ${preset.sortDir},
        ${preset.ownerUsername}, ${preset.createdAt}, ${preset.updatedAt}
      )
    `;
    return preset;
  }

  const all = await readFileAll();
  all.push(preset);
  await writeFileAll(all);
  return preset;
}

export async function updateReportPreset(
  id: string,
  updates: {
    name?: string;
    columns?: ReportPresetColumn[];
    sortBy?: string | null;
    sortDir?: "asc" | "desc" | null;
  }
): Promise<ReportPreset | null> {
  const now = new Date().toISOString();
  const columns = updates.columns ? normalizeColumns(updates.columns) : undefined;

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    // Lê o atual e mescla em JS para evitar fragmentos SQL aninhados.
    const existing = await sql`
      SELECT id, report_type, company_key, name, columns, sort_by, sort_dir,
             owner_username, created_at, updated_at
      FROM report_presets WHERE id = ${id} LIMIT 1
    `;
    const currentRow = existing[0] as Parameters<typeof rowToPreset>[0] | undefined;
    if (!currentRow) return null;
    const current = rowToPreset(currentRow);

    const nextName = updates.name?.trim() ?? current.name;
    const nextColumns = columns ?? current.columns;
    const nextSortBy = updates.sortBy === undefined ? current.sortBy ?? null : updates.sortBy;
    const nextSortDir = updates.sortDir === undefined ? current.sortDir ?? null : updates.sortDir;

    const rows = await sql`
      UPDATE report_presets
      SET name = ${nextName},
          columns = ${JSON.stringify(nextColumns)}::jsonb,
          sort_by = ${nextSortBy},
          sort_dir = ${nextSortDir},
          updated_at = ${now}
      WHERE id = ${id}
      RETURNING id, report_type, company_key, name, columns, sort_by, sort_dir,
                owner_username, created_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToPreset>[0] | undefined;
    return row ? rowToPreset(row) : null;
  }

  const all = await readFileAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const current = all[idx];
  const next: ReportPreset = {
    ...current,
    name: updates.name?.trim() ?? current.name,
    columns: columns ?? current.columns,
    sortBy: updates.sortBy === undefined ? current.sortBy : updates.sortBy,
    sortDir: updates.sortDir === undefined ? current.sortDir : updates.sortDir,
    updatedAt: now,
  };
  all[idx] = next;
  await writeFileAll(all);
  return next;
}

export async function deleteReportPreset(id: string): Promise<boolean> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      DELETE FROM report_presets WHERE id = ${id} RETURNING id
    `;
    return rows.length > 0;
  }

  const all = await readFileAll();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  await writeFileAll(next);
  return true;
}
