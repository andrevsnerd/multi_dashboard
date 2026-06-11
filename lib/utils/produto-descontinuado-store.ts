import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  buildDescontinuadoProductKey,
  normalizeDescontinuadoValue,
  type ProdutoDescontinuadoItem,
} from "@/lib/utils/produtos-descontinuados";

const PRODUTO_DESCONTINUADO_FILE = path.join(process.cwd(), "data", "produtos-descontinuados.json");

let tableChecked = false;

function ensureDataDir() {
  const dir = path.dirname(PRODUTO_DESCONTINUADO_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFileItems(): ProdutoDescontinuadoItem[] {
  ensureDataDir();

  if (!fs.existsSync(PRODUTO_DESCONTINUADO_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUTO_DESCONTINUADO_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileItems(rows: ProdutoDescontinuadoItem[]) {
  ensureDataDir();
  fs.writeFileSync(PRODUTO_DESCONTINUADO_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;

  await sql`
    CREATE TABLE IF NOT EXISTS produto_descontinuado_items (
      company TEXT NOT NULL,
      produto TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company, produto)
    )
  `;

  tableChecked = true;
}

function sortItems(items: ProdutoDescontinuadoItem[]): ProdutoDescontinuadoItem[] {
  return [...items].sort(
    (a, b) =>
      a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

export async function listProdutosDescontinuados(
  company: CompanyKey
): Promise<ProdutoDescontinuadoItem[]> {
  if (!hasPostgres()) {
    return sortItems(readFileItems().filter((row) => row.company === company));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT company, produto, descricao, created_at, updated_at
    FROM produto_descontinuado_items
    WHERE company = ${company}
    ORDER BY descricao, produto
  `;

  return sortItems(
    rows.map((row) => ({
      company: row.company as CompanyKey,
      produto: String(row.produto ?? "").trim(),
      descricao: String(row.descricao ?? "").trim(),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }))
  );
}

export async function saveProdutoDescontinuado(input: {
  company: CompanyKey;
  produto: string;
  descricao?: string | null;
}): Promise<ProdutoDescontinuadoItem> {
  const produto = normalizeDescontinuadoValue(input.produto);
  if (!produto) {
    throw new Error("Informe o código do produto.");
  }

  const descricao = normalizeDescontinuadoValue(input.descricao);
  const nowIso = new Date().toISOString();
  const existing = await listProdutosDescontinuados(input.company);
  const previous = existing.find(
    (item) => buildDescontinuadoProductKey(item.produto) === buildDescontinuadoProductKey(produto)
  );

  const nextItem: ProdutoDescontinuadoItem = {
    company: input.company,
    produto,
    descricao: descricao || previous?.descricao || produto,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (!hasPostgres()) {
    const nextItems = [
      ...readFileItems().filter(
        (row) =>
          !(
            row.company === input.company &&
            buildDescontinuadoProductKey(row.produto) === buildDescontinuadoProductKey(produto)
          )
      ),
      nextItem,
    ];
    writeFileItems(nextItems);
    return nextItem;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    INSERT INTO produto_descontinuado_items (company, produto, descricao, created_at, updated_at)
    VALUES (
      ${input.company},
      ${nextItem.produto},
      ${nextItem.descricao},
      ${previous?.createdAt ? new Date(previous.createdAt) : new Date(nowIso)},
      ${new Date(nowIso)}
    )
    ON CONFLICT (company, produto) DO UPDATE SET
      descricao = EXCLUDED.descricao,
      updated_at = EXCLUDED.updated_at
  `;

  return nextItem;
}

export async function deleteProdutoDescontinuado(
  company: CompanyKey,
  produto: string
): Promise<boolean> {
  const normalizedProduto = normalizeDescontinuadoValue(produto);
  if (!normalizedProduto) return false;

  if (!hasPostgres()) {
    const rows = readFileItems();
    const remaining = rows.filter(
      (row) =>
        !(
          row.company === company &&
          buildDescontinuadoProductKey(row.produto) === buildDescontinuadoProductKey(normalizedProduto)
        )
    );
    const removed = remaining.length !== rows.length;
    if (removed) {
      writeFileItems(remaining);
    }
    return removed;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    DELETE FROM produto_descontinuado_items
    WHERE company = ${company}
      AND produto = ${normalizedProduto}
    RETURNING produto
  `;

  return Array.isArray(result) ? result.length > 0 : false;
}
