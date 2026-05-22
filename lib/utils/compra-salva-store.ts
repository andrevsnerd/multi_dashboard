import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import type { CompraSalva, CompraSalvaItemRow, CompraSalvaListEntry } from "@/lib/types/compra-salva";

export type { CompraSalva, CompraSalvaItemRow, CompraSalvaListEntry } from "@/lib/types/compra-salva";

const FILE_PATH = path.join(process.cwd(), "data", "compras-salvas.json");

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
    CREATE TABLE IF NOT EXISTS compras_salvas (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      source_context_key TEXT NOT NULL,
      title TEXT NOT NULL,
      expandir_por_cor BOOLEAN NOT NULL DEFAULT true,
      items JSONB NOT NULL,
      comprada BOOLEAN NOT NULL DEFAULT false,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE compras_salvas ADD COLUMN IF NOT EXISTS comprada BOOLEAN NOT NULL DEFAULT false
  `;
  tableChecked = true;
}

function rowToCompraSalva(row: {
  id: string;
  company_key: string;
  source_context_key: string;
  title: string;
  expandir_por_cor: boolean;
  items: unknown;
  comprada?: boolean;
  saved_at: Date | string;
  updated_at: Date | string;
}): CompraSalva {
  const items = Array.isArray(row.items) ? (row.items as CompraSalvaItemRow[]) : [];
  return {
    id: row.id,
    companyKey: row.company_key,
    sourceContextKey: row.source_context_key,
    title: row.title,
    expandirPorCor: !!row.expandir_por_cor,
    items,
    comprada: !!row.comprada,
    savedAt: new Date(row.saved_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readFileAll(): Promise<CompraSalva[]> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CompraSalva[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(rows: CompraSalva[]) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), "utf-8");
}

function toListEntry(c: CompraSalva): CompraSalvaListEntry {
  const totalQtdManual = c.items.reduce((s, i) => s + Math.max(0, Math.round(i.qtdManual ?? 0)), 0);
  const totalValor = c.items.reduce((s, i) => {
    const cu = i.custoUnitario ?? 0;
    return cu > 0 ? s + Math.round((i.qtdManual ?? 0) * cu) : s;
  }, 0);
  return {
    id: c.id,
    title: c.title,
    itemCount: c.items.length,
    totalQtdManual,
    totalValor,
    comprada: !!c.comprada,
    savedAt: c.savedAt,
    updatedAt: c.updatedAt,
  };
}

export async function listComprasSalvasFull(companyKey: string): Promise<CompraSalva[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
      FROM compras_salvas
      WHERE company_key = ${companyKey}
      ORDER BY saved_at DESC
    `;
    return rows.map((r) => rowToCompraSalva(r as never));
  }

  const all = await readFileAll();
  return all
    .filter((c) => c.companyKey === companyKey)
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

export async function listComprasSalvas(companyKey: string): Promise<CompraSalvaListEntry[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
      FROM compras_salvas
      WHERE company_key = ${companyKey}
      ORDER BY saved_at DESC
    `;
    return rows.map((r) => toListEntry(rowToCompraSalva(r as never)));
  }

  const all = await readFileAll();
  return all
    .filter((c) => c.companyKey === companyKey)
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .map(toListEntry);
}

export async function getCompraSalva(companyKey: string, id: string): Promise<CompraSalva | null> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
      FROM compras_salvas
      WHERE id = ${id} AND company_key = ${companyKey}
      LIMIT 1
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  const all = await readFileAll();
  const c = all.find((x) => x.id === id && x.companyKey === companyKey);
  return c ?? null;
}

export async function createCompraSalva(input: {
  companyKey: string;
  sourceContextKey: string;
  title: string;
  expandirPorCor: boolean;
  items: CompraSalvaItemRow[];
}): Promise<CompraSalva> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: CompraSalva = {
    id,
    companyKey: input.companyKey,
    sourceContextKey: input.sourceContextKey,
    title: input.title.trim(),
    expandirPorCor: input.expandirPorCor,
    items: input.items.map((i) => ({
      ...i,
      qtdManual: Math.max(0, Math.round(i.qtdManual ?? 0)),
    })),
    comprada: false,
    savedAt: now,
    updatedAt: now,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compras_salvas (
        id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
      ) VALUES (
        ${row.id}, ${row.companyKey}, ${row.sourceContextKey}, ${row.title},
        ${row.expandirPorCor}, ${JSON.stringify(row.items)}::jsonb,
        ${row.comprada}, ${row.savedAt}, ${row.updatedAt}
      )
    `;
    return row;
  }

  const all = await readFileAll();
  all.push(row);
  await writeFileAll(all);
  return row;
}

export async function updateCompraSalvaItemQtd(
  companyKey: string,
  id: string,
  itemKey: string,
  qtdManual: number
): Promise<CompraSalva | null> {
  const updatedAt = new Date().toISOString();
  const qtd = Math.max(0, Math.round(qtdManual));

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    // Atualiza o item no JSONB diretamente sem re-fetch prévio
    const rows = await sql`
      UPDATE compras_salvas
      SET items = (
        SELECT jsonb_agg(
          CASE WHEN (elem->>'itemKey') = ${itemKey}
            THEN jsonb_set(elem, '{qtdManual}', ${qtd}::text::jsonb)
            ELSE elem
          END
        )
        FROM jsonb_array_elements(items) AS elem
      ),
      updated_at = ${updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id, company_key, source_context_key, title, expandir_por_cor, items, saved_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  // Fallback JSON: leitura única, modificação, escrita
  const all = await readFileAll();
  const i = all.findIndex((x) => x.id === id && x.companyKey === companyKey);
  if (i < 0) return null;
  const c = all[i];
  const idx = c.items.findIndex((item) => item.itemKey === itemKey);
  if (idx < 0) return c;
  const nextItems = [...c.items];
  nextItems[idx] = { ...nextItems[idx], qtdManual: qtd };
  all[i] = { ...c, items: nextItems, updatedAt };
  await writeFileAll(all);
  return all[i];
}

function normalizeCompraSalvaItemRow(input: CompraSalvaItemRow): CompraSalvaItemRow {
  return {
    itemKey: String(input.itemKey ?? "").trim(),
    produto: String(input.produto ?? "").trim(),
    corProduto: input.corProduto ? String(input.corProduto).trim() : undefined,
    corDescricao: input.corDescricao ? String(input.corDescricao).trim() : undefined,
    descricao: String(input.descricao ?? input.produto ?? "").trim(),
    grade: input.grade ? String(input.grade).trim() : undefined,
    colecao: input.colecao ? String(input.colecao).trim() : undefined,
    qtdManual: Math.max(0, Math.round(input.qtdManual ?? 0)),
    custoUnitario: input.custoUnitario != null ? Number(input.custoUnitario) : undefined,
    filialOrigem: input.filialOrigem === null
      ? null
      : input.filialOrigem != null
        ? String(input.filialOrigem).trim()
        : undefined,
  };
}

function mergeCompraSalvaItems(
  currentItems: CompraSalvaItemRow[],
  item: CompraSalvaItemRow
): CompraSalvaItemRow[] {
  const normalizedItem = normalizeCompraSalvaItemRow(item);
  const idx = currentItems.findIndex((current) => String(current.itemKey ?? "").trim() === normalizedItem.itemKey);

  if (idx < 0) {
    return [...currentItems, normalizedItem];
  }

  const current = currentItems[idx];
  const next = [...currentItems];
  next[idx] = {
    ...current,
    ...normalizedItem,
    corProduto: normalizedItem.corProduto ?? current.corProduto,
    corDescricao: normalizedItem.corDescricao ?? current.corDescricao,
    grade: normalizedItem.grade ?? current.grade,
    colecao: normalizedItem.colecao ?? current.colecao,
    custoUnitario: normalizedItem.custoUnitario ?? current.custoUnitario,
    filialOrigem: normalizedItem.filialOrigem ?? current.filialOrigem,
    qtdManual: Math.max(0, Math.round(current.qtdManual ?? 0)) + normalizedItem.qtdManual,
  };
  return next;
}

export async function addCompraSalvaItem(
  companyKey: string,
  id: string,
  item: CompraSalvaItemRow
): Promise<CompraSalva | null> {
  const updatedAt = new Date().toISOString();

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const current = await getCompraSalva(companyKey, id);
    if (!current) return null;
    const nextItems = mergeCompraSalvaItems(current.items, item);
    const rows = await sql`
      UPDATE compras_salvas
      SET items = ${JSON.stringify(nextItems)}::jsonb,
      updated_at = ${updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  const all = await readFileAll();
  const i = all.findIndex((x) => x.id === id && x.companyKey === companyKey);
  if (i < 0) return null;
  const c = all[i];
  all[i] = {
    ...c,
    items: mergeCompraSalvaItems(c.items, item),
    updatedAt,
  };
  await writeFileAll(all);
  return all[i];
}

export async function removeCompraSalvaItem(companyKey: string, id: string, itemKey: string): Promise<CompraSalva | null> {
  const updatedAt = new Date().toISOString();
  const normalizedItemKey = itemKey.trim();

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const current = await getCompraSalva(companyKey, id);
    if (!current) return null;
    const nextItems = current.items.filter((item) => String(item.itemKey ?? "").trim() !== normalizedItemKey);
    const rows = await sql`
      UPDATE compras_salvas
      SET items = ${JSON.stringify(nextItems)}::jsonb,
      updated_at = ${updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  // Fallback JSON: leitura única, modificação, escrita
  const all = await readFileAll();
  const i = all.findIndex((x) => x.id === id && x.companyKey === companyKey);
  if (i < 0) return null;
  const c = all[i];
  const nextItems = c.items.filter((item) => String(item.itemKey ?? "").trim() !== normalizedItemKey);
  all[i] = { ...c, items: nextItems, updatedAt };
  await writeFileAll(all);
  return all[i];
}

export async function updateCompraSalvaTitle(companyKey: string, id: string, title: string): Promise<CompraSalva | null> {
  const t = title.trim();
  if (!t) return getCompraSalva(companyKey, id);
  const updatedAt = new Date().toISOString();

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      UPDATE compras_salvas
      SET title = ${t}, updated_at = ${updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id, company_key, source_context_key, title, expandir_por_cor, items, saved_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  // Fallback JSON: leitura única, modificação, escrita
  const all = await readFileAll();
  const i = all.findIndex((x) => x.id === id && x.companyKey === companyKey);
  if (i < 0) return null;
  all[i] = { ...all[i], title: t, updatedAt };
  await writeFileAll(all);
  return all[i];
}

export async function toggleCompraSalvaComprada(
  companyKey: string,
  id: string,
  comprada: boolean
): Promise<CompraSalva | null> {
  const updatedAt = new Date().toISOString();

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      UPDATE compras_salvas
      SET comprada = ${comprada}, updated_at = ${updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id, company_key, source_context_key, title, expandir_por_cor, items, comprada, saved_at, updated_at
    `;
    const row = rows[0] as Parameters<typeof rowToCompraSalva>[0] | undefined;
    return row ? rowToCompraSalva(row) : null;
  }

  const all = await readFileAll();
  const i = all.findIndex((x) => x.id === id && x.companyKey === companyKey);
  if (i < 0) return null;
  all[i] = { ...all[i], comprada, updatedAt };
  await writeFileAll(all);
  return all[i];
}

export async function deleteCompraSalva(companyKey: string, id: string): Promise<boolean> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const result = await sql`
      DELETE FROM compras_salvas WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id
    `;
    return result.length > 0;
  }

  const all = await readFileAll();
  const next = all.filter((x) => !(x.id === id && x.companyKey === companyKey));
  if (next.length === all.length) return false;
  await writeFileAll(next);
  return true;
}
