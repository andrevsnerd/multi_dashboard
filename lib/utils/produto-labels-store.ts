import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";

const PRODUTO_LABELS_FILE = path.join(process.cwd(), "data", "produto-labels.json");

let tableChecked = false;

export interface ProdutoLabelRecord {
  company: CompanyKey;
  produto: string;
  cor: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface ProdutoLabelKeyInput {
  produto: string;
  cor?: string | null;
}

function ensureDataDir() {
  const dir = path.dirname(PRODUTO_LABELS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readProdutoLabelsFile(): ProdutoLabelRecord[] {
  ensureDataDir();

  if (!fs.existsSync(PRODUTO_LABELS_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUTO_LABELS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProdutoLabelsFile(rows: ProdutoLabelRecord[]) {
  ensureDataDir();
  fs.writeFileSync(PRODUTO_LABELS_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

function normalizeValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function makeCompositeKey(produto: string, cor: string, label: string): string {
  return `${produto}::${cor}::${label}`.toUpperCase();
}

export function buildProdutoLabelLookupKey(produto: string | null | undefined, cor: string | null | undefined): string {
  return `${normalizeValue(produto)}::${normalizeValue(cor)}`.toUpperCase();
}

function normalizeIncomingKeys(items: ProdutoLabelKeyInput[]): Array<{ produto: string; cor: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ produto: string; cor: string }> = [];

  for (const item of items) {
    const produto = normalizeValue(item.produto);
    if (!produto) continue;

    const cor = normalizeValue(item.cor);
    const key = `${produto}::${cor}`.toUpperCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push({ produto, cor });
  }

  return normalized;
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;

  await sql`
    CREATE TABLE IF NOT EXISTS produto_labels (
      company TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company, produto, cor, label)
    )
  `;

  tableChecked = true;
}

export async function listProdutoLabels(
  company: CompanyKey,
  label: string
): Promise<ProdutoLabelRecord[]> {
  const normalizedLabel = normalizeValue(label);

  if (!hasPostgres()) {
    return readProdutoLabelsFile()
      .filter((row) => row.company === company && row.label === normalizedLabel)
      .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR") || a.cor.localeCompare(b.cor, "pt-BR"));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT company, produto, cor, label, created_at, updated_at
    FROM produto_labels
    WHERE company = ${company}
      AND label = ${normalizedLabel}
    ORDER BY produto, cor
  `;

  return rows.map((row) => ({
    company: row.company as CompanyKey,
    produto: String(row.produto ?? "").trim(),
    cor: String(row.cor ?? "").trim(),
    label: String(row.label ?? "").trim(),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

export async function listProdutoLabelLookupKeys(
  company: CompanyKey,
  label: string
): Promise<Set<string>> {
  const rows = await listProdutoLabels(company, label);
  return new Set(rows.map((row) => buildProdutoLabelLookupKey(row.produto, row.cor)));
}

export async function syncProdutoLabelSet(
  company: CompanyKey,
  label: string,
  items: ProdutoLabelKeyInput[]
): Promise<{ total: number; inserted: number; removed: number }> {
  const normalizedLabel = normalizeValue(label);
  const normalizedItems = normalizeIncomingKeys(items);
  const nowIso = new Date().toISOString();

  if (!hasPostgres()) {
    const existingRows = readProdutoLabelsFile();
    const targetRows = existingRows.filter((row) => row.company === company && row.label === normalizedLabel);
    const targetMap = new Map(
      targetRows.map((row) => [makeCompositeKey(row.produto, row.cor, row.label), row] as const)
    );

    const nextTargetRows: ProdutoLabelRecord[] = [];
    let inserted = 0;

    for (const item of normalizedItems) {
      const key = makeCompositeKey(item.produto, item.cor, normalizedLabel);
      const existing = targetMap.get(key);

      if (existing) {
        nextTargetRows.push({
          ...existing,
          updatedAt: nowIso,
        });
      } else {
        inserted += 1;
        nextTargetRows.push({
          company,
          produto: item.produto,
          cor: item.cor,
          label: normalizedLabel,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    const nextKeys = new Set(
      nextTargetRows.map((row) => makeCompositeKey(row.produto, row.cor, row.label))
    );
    const removed = targetRows.filter(
      (row) => !nextKeys.has(makeCompositeKey(row.produto, row.cor, row.label))
    ).length;

    const preservedOtherRows = existingRows.filter(
      (row) => !(row.company === company && row.label === normalizedLabel)
    );

    writeProdutoLabelsFile([...preservedOtherRows, ...nextTargetRows]);

    return {
      total: nextTargetRows.length,
      inserted,
      removed,
    };
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const existingRows = await listProdutoLabels(company, normalizedLabel);
  const existingMap = new Map(
    existingRows.map((row) => [makeCompositeKey(row.produto, row.cor, row.label), row] as const)
  );
  const nextKeys = new Set(
    normalizedItems.map((item) => makeCompositeKey(item.produto, item.cor, normalizedLabel))
  );

  let inserted = 0;
  let removed = 0;

  for (const row of existingRows) {
    const key = makeCompositeKey(row.produto, row.cor, row.label);
    if (nextKeys.has(key)) continue;

    await sql`
      DELETE FROM produto_labels
      WHERE company = ${company}
        AND produto = ${row.produto}
        AND cor = ${row.cor}
        AND label = ${normalizedLabel}
    `;
    removed += 1;
  }

  for (const item of normalizedItems) {
    const key = makeCompositeKey(item.produto, item.cor, normalizedLabel);
    const existed = existingMap.has(key);

    await sql`
      INSERT INTO produto_labels (company, produto, cor, label, updated_at)
      VALUES (${company}, ${item.produto}, ${item.cor}, ${normalizedLabel}, NOW())
      ON CONFLICT (company, produto, cor, label) DO UPDATE SET
        updated_at = NOW()
    `;

    if (!existed) {
      inserted += 1;
    }
  }

  return {
    total: normalizedItems.length,
    inserted,
    removed,
  };
}
