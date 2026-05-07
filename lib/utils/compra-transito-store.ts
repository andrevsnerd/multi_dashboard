import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import type {
  CompraTransito,
  CompraTransitoItemRow,
  CompraTransitoListEntry,
} from "@/lib/types/compra-transito";
import {
  getCompraTransitoItemStatus,
  getCompraTransitoStatusFromItems,
} from "@/lib/utils/compra-transito-status";

export type {
  CompraTransito,
  CompraTransitoItemRow,
  CompraTransitoListEntry,
} from "@/lib/types/compra-transito";

const FILE_PATH = path.join(process.cwd(), "data", "compras-transito.json");

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
    CREATE TABLE IF NOT EXISTS compras_transito (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      items JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

function normalizeDate(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const isoDate = raw.slice(0, 10);
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toISOString().slice(0, 10);
}

function normalizeItem(row: CompraTransitoItemRow): CompraTransitoItemRow {
  const dataRecebimento = normalizeDate(row.dataRecebimento);
  return {
    itemKey: String(row.itemKey ?? "").trim(),
    produto: String(row.produto ?? "").trim(),
    descricao: String(row.descricao ?? row.produto ?? "").trim(),
    corProduto: row.corProduto ? String(row.corProduto).trim() : undefined,
    corDescricao: row.corDescricao ? String(row.corDescricao).trim() : undefined,
    grade: row.grade ? String(row.grade).trim() : undefined,
    dataRecebimento,
    quantidade: Math.max(0, Math.round(Number(row.quantidade ?? 0))),
    custoUnitario:
      row.custoUnitario != null && Number.isFinite(Number(row.custoUnitario))
        ? Number(row.custoUnitario)
        : undefined,
    estoqueAtual:
      row.estoqueAtual != null && Number.isFinite(Number(row.estoqueAtual))
        ? Number(row.estoqueAtual)
        : undefined,
    status: getCompraTransitoItemStatus(dataRecebimento),
  };
}

function rowToCompraTransito(row: {
  id: string;
  company_key: string;
  title: string;
  status: string;
  items: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  confirmed_at: Date | string;
}): CompraTransito {
  const items = Array.isArray(row.items)
    ? (row.items as CompraTransitoItemRow[]).map(normalizeItem)
    : [];

  return {
    id: row.id,
    companyKey: row.company_key,
    title: row.title,
    status: getCompraTransitoStatusFromItems(items),
    items,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    confirmedAt: new Date(row.confirmed_at).toISOString(),
  };
}

async function readFileAll(): Promise<CompraTransito[]> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CompraTransito[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(rows: CompraTransito[]) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), "utf-8");
}

function toListEntry(compra: CompraTransito): CompraTransitoListEntry {
  const totalQuantidade = compra.items.reduce(
    (sum, item) => sum + Math.max(0, Math.round(item.quantidade ?? 0)),
    0
  );
  const totalValor = compra.items.reduce((sum, item) => {
    const custo = Number(item.custoUnitario ?? 0);
    return custo > 0 ? sum + Math.round((item.quantidade ?? 0) * custo) : sum;
  }, 0);

  const validDates = compra.items
    .map((item) => normalizeDate(item.dataRecebimento))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return {
    id: compra.id,
    title: compra.title,
    itemCount: compra.items.length,
    totalQuantidade,
    totalValor,
    status: getCompraTransitoStatusFromItems(compra.items),
    minDataRecebimento: validDates[0] ?? null,
    maxDataRecebimento: validDates[validDates.length - 1] ?? null,
    createdAt: compra.createdAt,
    updatedAt: compra.updatedAt,
    confirmedAt: compra.confirmedAt,
  };
}

export async function listComprasTransitoFull(companyKey: string): Promise<CompraTransito[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, company_key, title, status, items, created_at, updated_at, confirmed_at
      FROM compras_transito
      WHERE company_key = ${companyKey}
      ORDER BY confirmed_at DESC
    `;
    return rows.map((row) => rowToCompraTransito(row as never));
  }

  const all = await readFileAll();
  return all
    .filter((item) => item.companyKey === companyKey)
    .map((item) => {
      const normalizedItems = (item.items ?? []).map(normalizeItem);
      return {
        ...item,
        status: getCompraTransitoStatusFromItems(normalizedItems),
        items: normalizedItems,
      };
    })
    .sort(
      (a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()
    );
}

export async function listComprasTransito(companyKey: string): Promise<CompraTransitoListEntry[]> {
  const full = await listComprasTransitoFull(companyKey);
  return full.map(toListEntry);
}

export async function getCompraTransito(
  companyKey: string,
  id: string
): Promise<CompraTransito | null> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, company_key, title, status, items, created_at, updated_at, confirmed_at
      FROM compras_transito
      WHERE id = ${id} AND company_key = ${companyKey}
      LIMIT 1
    `;
    const row = rows[0] as Parameters<typeof rowToCompraTransito>[0] | undefined;
    return row ? rowToCompraTransito(row) : null;
  }

  const all = await readFileAll();
  const found = all.find((item) => item.id === id && item.companyKey === companyKey);
  return found
    ? {
        ...found,
        status: getCompraTransitoStatusFromItems(found.items ?? []),
        items: (found.items ?? []).map(normalizeItem),
      }
    : null;
}

export async function createCompraTransito(input: {
  companyKey: string;
  title: string;
  items: CompraTransitoItemRow[];
}): Promise<CompraTransito> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: CompraTransito = {
    id,
    companyKey: input.companyKey,
    title: input.title.trim(),
    status: getCompraTransitoStatusFromItems(input.items),
    items: input.items.map(normalizeItem),
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compras_transito (
        id, company_key, title, status, items, created_at, updated_at, confirmed_at
      ) VALUES (
        ${row.id},
        ${row.companyKey},
        ${row.title},
        ${row.status},
        ${JSON.stringify(row.items)}::jsonb,
        ${row.createdAt},
        ${row.updatedAt},
        ${row.confirmedAt}
      )
    `;
    return row;
  }

  const all = await readFileAll();
  all.push(row);
  await writeFileAll(all);
  return row;
}

export async function deleteCompraTransito(companyKey: string, id: string): Promise<boolean> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const result = await sql`
      DELETE FROM compras_transito
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id
    `;
    return result.length > 0;
  }

  const all = await readFileAll();
  const next = all.filter((item) => !(item.id === id && item.companyKey === companyKey));
  if (next.length === all.length) return false;
  await writeFileAll(next);
  return true;
}
