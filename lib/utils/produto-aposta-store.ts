import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  buildApostaProductKey,
  normalizeApostaValue,
  type ProdutoApostaItem,
} from "@/lib/utils/produtos-aposta";

const PRODUTO_APOSTA_FILE = path.join(process.cwd(), "data", "produtos-aposta.json");

let ensurePromise: Promise<void> | null = null;

function ensureDataDir() {
  const dir = path.dirname(PRODUTO_APOSTA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFileItems(): ProdutoApostaItem[] {
  ensureDataDir();

  if (!fs.existsSync(PRODUTO_APOSTA_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUTO_APOSTA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileItems(rows: ProdutoApostaItem[]) {
  ensureDataDir();
  fs.writeFileSync(PRODUTO_APOSTA_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

/** CREATE TABLE IF NOT EXISTS não é atômico: corrida entre instâncias dá 23505/42P07 — é sucesso. */
function isDdlRaceError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS produto_aposta_items (
            company TEXT NOT NULL,
            produto TEXT NOT NULL,
            descricao TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (company, produto)
          )
        `;
      } catch (error) {
        if (!isDdlRaceError(error)) throw error;
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  await ensurePromise;
}

function sortItems(items: ProdutoApostaItem[]): ProdutoApostaItem[] {
  return [...items].sort(
    (a, b) =>
      a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

export async function listProdutosAposta(company: CompanyKey): Promise<ProdutoApostaItem[]> {
  if (!hasPostgres()) {
    return sortItems(readFileItems().filter((row) => row.company === company));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT company, produto, descricao, created_at, updated_at
    FROM produto_aposta_items
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

export async function saveProdutoAposta(input: {
  company: CompanyKey;
  produto: string;
  descricao?: string | null;
}): Promise<ProdutoApostaItem> {
  const produto = normalizeApostaValue(input.produto);
  if (!produto) {
    throw new Error("Informe o código do produto.");
  }

  const descricao = normalizeApostaValue(input.descricao);
  const nowIso = new Date().toISOString();
  const existing = await listProdutosAposta(input.company);
  const previous = existing.find(
    (item) => buildApostaProductKey(item.produto) === buildApostaProductKey(produto)
  );

  const nextItem: ProdutoApostaItem = {
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
            buildApostaProductKey(row.produto) === buildApostaProductKey(produto)
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
    INSERT INTO produto_aposta_items (company, produto, descricao, created_at, updated_at)
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

export async function deleteProdutoAposta(company: CompanyKey, produto: string): Promise<boolean> {
  const normalizedProduto = normalizeApostaValue(produto);
  if (!normalizedProduto) return false;

  if (!hasPostgres()) {
    const rows = readFileItems();
    const remaining = rows.filter(
      (row) =>
        !(
          row.company === company &&
          buildApostaProductKey(row.produto) === buildApostaProductKey(normalizedProduto)
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
    DELETE FROM produto_aposta_items
    WHERE company = ${company}
      AND produto = ${normalizedProduto}
    RETURNING produto
  `;

  return Array.isArray(result) ? result.length > 0 : false;
}
