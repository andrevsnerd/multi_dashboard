import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * Observações livres por item do painel Black Friday — mesmo funcionamento da
 * Curva ABC (`curva-abc-observacoes-store`), em tabela própria e sem escopo de
 * filial (o painel não filtra filial). `cor` = '' é a observação do produto
 * (visão "Por produto"); com cor, vale para a linha daquela cor.
 */

const BLACK_FRIDAY_OBSERVACOES_FILE = path.join(process.cwd(), "data", "black-friday-observacoes.json");

export interface BlackFridayObservacaoRecord {
  company: CompanyKey;
  produto: string;
  cor: string;
  observacao: string;
  usuario: string;
  createdAt: string;
  updatedAt: string;
}

interface SaveBlackFridayObservacaoInput {
  company: CompanyKey;
  produto: string;
  cor?: string | null;
  observacao?: string | null;
  usuario?: string | null;
}

const MAX_OBSERVACAO = 240;

function normalizeValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/* ── fallback em arquivo (sem Postgres) ── */

function readFile(): BlackFridayObservacaoRecord[] {
  try {
    if (!fs.existsSync(BLACK_FRIDAY_OBSERVACOES_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(BLACK_FRIDAY_OBSERVACOES_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFile(rows: BlackFridayObservacaoRecord[]) {
  const dir = path.dirname(BLACK_FRIDAY_OBSERVACOES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BLACK_FRIDAY_OBSERVACOES_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

const fileKey = (company: string, produto: string, cor: string) => `${company}::${produto}::${cor}`.toUpperCase();

/* ── Neon ── */

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;

/** DDL concorrente: "já existe" (23505 em pg_type / 42P07 / 42710) é sucesso. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ddl(exec: () => Promise<unknown>): Promise<void> {
  try {
    await exec();
  } catch (erro) {
    if (!objetoJaExiste(erro)) throw erro;
  }
}

async function ensureTable(): Promise<void> {
  if (tableChecked) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getNeonSql();
      await ddl(() => sql`
        CREATE TABLE IF NOT EXISTS black_friday_observacoes (
          company TEXT NOT NULL,
          produto TEXT NOT NULL,
          cor TEXT NOT NULL DEFAULT '',
          observacao TEXT NOT NULL,
          usuario TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (company, produto, cor)
        )
      `);
    })()
      .then(() => {
        tableChecked = true;
      })
      .catch((erro) => {
        ensurePromise = null;
        throw erro;
      });
  }
  return ensurePromise;
}

function mapRow(row: Record<string, unknown>): BlackFridayObservacaoRecord {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
  return {
    company: row.company as CompanyKey,
    produto: normalizeValue(row.produto as string),
    cor: normalizeValue(row.cor as string),
    observacao: normalizeValue(row.observacao as string),
    usuario: normalizeValue(row.usuario as string),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listBlackFridayObservacoes(company: CompanyKey): Promise<BlackFridayObservacaoRecord[]> {
  if (!hasPostgres()) {
    return readFile().filter((row) => row.company === company);
  }

  await ensureTable();
  const sql = getNeonSql();
  const rows = await sql`
    SELECT company, produto, cor, observacao, usuario, created_at, updated_at
    FROM black_friday_observacoes
    WHERE company = ${company}
    ORDER BY produto, cor
  `;
  return rows.map((row) => mapRow(row as Record<string, unknown>));
}

/** Grava (ou apaga, se vazia) a observação do item. Devolve null quando apagou. */
export async function saveBlackFridayObservacao(
  input: SaveBlackFridayObservacaoInput
): Promise<BlackFridayObservacaoRecord | null> {
  const produto = normalizeValue(input.produto);
  const cor = normalizeValue(input.cor);
  const observacao = normalizeValue(input.observacao);
  const usuario = normalizeValue(input.usuario);

  if (!produto) throw new Error("Produto é obrigatório.");
  if (observacao.length > MAX_OBSERVACAO) {
    throw new Error(`Observação passa de ${MAX_OBSERVACAO} caracteres.`);
  }

  if (!hasPostgres()) {
    const rows = readFile();
    const key = fileKey(input.company, produto, cor);
    const existing = rows.find((r) => fileKey(r.company, r.produto, r.cor) === key);
    const others = rows.filter((r) => fileKey(r.company, r.produto, r.cor) !== key);
    if (!observacao) {
      writeFile(others);
      return null;
    }
    const nowIso = new Date().toISOString();
    const record: BlackFridayObservacaoRecord = {
      company: input.company,
      produto,
      cor,
      observacao,
      usuario,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    writeFile([...others, record]);
    return record;
  }

  await ensureTable();
  const sql = getNeonSql();

  if (!observacao) {
    await sql`
      DELETE FROM black_friday_observacoes
      WHERE company = ${input.company} AND produto = ${produto} AND cor = ${cor}
    `;
    return null;
  }

  const rows = await sql`
    INSERT INTO black_friday_observacoes (company, produto, cor, observacao, usuario, updated_at)
    VALUES (${input.company}, ${produto}, ${cor}, ${observacao}, ${usuario}, NOW())
    ON CONFLICT (company, produto, cor) DO UPDATE SET
      observacao = EXCLUDED.observacao,
      usuario = EXCLUDED.usuario,
      updated_at = NOW()
    RETURNING company, produto, cor, observacao, usuario, created_at, updated_at
  `;
  return mapRow(rows[0] as Record<string, unknown>);
}
