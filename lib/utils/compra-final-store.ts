import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

export interface CompraFinalItem {
  companyKey: string;
  contextKey: string;
  itemKey: string; // produto||corProduto
  produto: string;
  corProduto?: string;
  corDescricao?: string;
  descricao: string;
  grade?: string;
  colecao?: string;
  qtdManual: number;
  createdAt: string;
  updatedAt: string;
}

const FILE_PATH = path.join(process.cwd(), "data", "compra-final.json");

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
    await fs.writeFile(FILE_PATH, JSON.stringify({}), "utf-8");
  }
}

async function ensureTable() {
  if (tableChecked) return;
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS compra_final_items (
      company_key TEXT NOT NULL,
      context_key TEXT NOT NULL,
      item_key TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor_produto TEXT,
      cor_descricao TEXT,
      descricao TEXT NOT NULL,
      grade TEXT,
      colecao TEXT,
      qtd_manual INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_key, context_key, item_key)
    )
  `;
  tableChecked = true;
}

function rowToItem(row: any): CompraFinalItem {
  return {
    companyKey: row.company_key,
    contextKey: row.context_key,
    itemKey: row.item_key,
    produto: row.produto,
    corProduto: row.cor_produto ?? undefined,
    corDescricao: row.cor_descricao ?? undefined,
    descricao: row.descricao,
    grade: row.grade ?? undefined,
    colecao: row.colecao ?? undefined,
    qtdManual: Number(row.qtd_manual ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

type FileDB = Record<string, CompraFinalItem[]>; // contextKeyGlobal -> items
function fileContextKey(companyKey: string, contextKey: string) {
  return `${companyKey}::${contextKey}`;
}

async function readFileDb(): Promise<FileDB> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    return JSON.parse(raw) as FileDB;
  } catch {
    return {};
  }
}

async function writeFileDb(db: FileDB) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export async function listCompraFinalItems(companyKey: string, contextKey: string): Promise<CompraFinalItem[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT company_key, context_key, item_key, produto, cor_produto, cor_descricao,
             descricao, grade, colecao, qtd_manual, created_at, updated_at
      FROM compra_final_items
      WHERE company_key = ${companyKey} AND context_key = ${contextKey}
      ORDER BY updated_at DESC
    `;
    return rows.map(rowToItem);
  }

  const db = await readFileDb();
  return db[fileContextKey(companyKey, contextKey)] ?? [];
}

export async function upsertCompraFinalItem(
  item: Omit<CompraFinalItem, "createdAt" | "updatedAt">
): Promise<void> {
  const now = new Date().toISOString();
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compra_final_items (
        company_key, context_key, item_key, produto, cor_produto, cor_descricao,
        descricao, grade, colecao, qtd_manual
      ) VALUES (
        ${item.companyKey}, ${item.contextKey}, ${item.itemKey}, ${item.produto},
        ${item.corProduto ?? null}, ${item.corDescricao ?? null},
        ${item.descricao}, ${item.grade ?? null}, ${item.colecao ?? null},
        ${Math.round(item.qtdManual)}
      )
      ON CONFLICT (company_key, context_key, item_key)
      DO UPDATE SET
        produto = EXCLUDED.produto,
        cor_produto = EXCLUDED.cor_produto,
        cor_descricao = EXCLUDED.cor_descricao,
        descricao = EXCLUDED.descricao,
        grade = EXCLUDED.grade,
        colecao = EXCLUDED.colecao,
        qtd_manual = EXCLUDED.qtd_manual,
        updated_at = NOW()
    `;
    return;
  }

  const db = await readFileDb();
  const k = fileContextKey(item.companyKey, item.contextKey);
  const items = db[k] ?? [];
  const idx = items.findIndex((i) => i.itemKey === item.itemKey);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...item, updatedAt: now };
  } else {
    items.unshift({ ...item, createdAt: now, updatedAt: now });
  }
  db[k] = items;
  await writeFileDb(db);
}

export async function updateCompraFinalQtd(
  companyKey: string,
  contextKey: string,
  itemKey: string,
  qtdManual: number
): Promise<void> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      UPDATE compra_final_items
      SET qtd_manual = ${Math.round(qtdManual)}, updated_at = NOW()
      WHERE company_key = ${companyKey} AND context_key = ${contextKey} AND item_key = ${itemKey}
    `;
    return;
  }

  const db = await readFileDb();
  const k = fileContextKey(companyKey, contextKey);
  const items = db[k] ?? [];
  const idx = items.findIndex((i) => i.itemKey === itemKey);
  if (idx >= 0) {
    items[idx] = { ...items[idx], qtdManual: Math.round(qtdManual), updatedAt: new Date().toISOString() };
    db[k] = items;
    await writeFileDb(db);
  }
}

export async function removeCompraFinalItem(companyKey: string, contextKey: string, itemKey: string): Promise<void> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      DELETE FROM compra_final_items
      WHERE company_key = ${companyKey} AND context_key = ${contextKey} AND item_key = ${itemKey}
    `;
    return;
  }

  const db = await readFileDb();
  const k = fileContextKey(companyKey, contextKey);
  const items = (db[k] ?? []).filter((i) => i.itemKey !== itemKey);
  db[k] = items;
  await writeFileDb(db);
}

