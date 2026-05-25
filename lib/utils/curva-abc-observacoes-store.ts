import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";

const CURVA_ABC_OBSERVACOES_FILE = path.join(process.cwd(), "data", "curva-abc-observacoes.json");

let tableChecked = false;

export interface CurvaAbcObservacaoRecord {
  company: CompanyKey;
  produto: string;
  cor: string;
  observacao: string;
  createdAt: string;
  updatedAt: string;
}

interface SaveCurvaAbcObservacaoInput {
  company: CompanyKey;
  produto: string;
  cor?: string | null;
  observacao?: string | null;
}

function ensureDataDir() {
  const dir = path.dirname(CURVA_ABC_OBSERVACOES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readCurvaAbcObservacoesFile(): CurvaAbcObservacaoRecord[] {
  ensureDataDir();

  if (!fs.existsSync(CURVA_ABC_OBSERVACOES_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CURVA_ABC_OBSERVACOES_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCurvaAbcObservacoesFile(rows: CurvaAbcObservacaoRecord[]) {
  ensureDataDir();
  fs.writeFileSync(CURVA_ABC_OBSERVACOES_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

function normalizeValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function makeCompositeKey(company: CompanyKey, produto: string, cor: string): string {
  return `${company}::${produto}::${cor}`.toUpperCase();
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;

  await sql`
    CREATE TABLE IF NOT EXISTS curva_abc_observacoes (
      company TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company, produto, cor)
    )
  `;

  tableChecked = true;
}

export async function listCurvaAbcObservacoes(company: CompanyKey): Promise<CurvaAbcObservacaoRecord[]> {
  if (!hasPostgres()) {
    return readCurvaAbcObservacoesFile()
      .filter((row) => row.company === company)
      .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR") || a.cor.localeCompare(b.cor, "pt-BR"));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT company, produto, cor, observacao, created_at, updated_at
    FROM curva_abc_observacoes
    WHERE company = ${company}
    ORDER BY produto, cor
  `;

  return rows.map((row) => ({
    company: row.company as CompanyKey,
    produto: normalizeValue(row.produto),
    cor: normalizeValue(row.cor),
    observacao: normalizeValue(row.observacao),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

export async function saveCurvaAbcObservacao(
  input: SaveCurvaAbcObservacaoInput
): Promise<CurvaAbcObservacaoRecord | null> {
  const produto = normalizeValue(input.produto);
  const cor = normalizeValue(input.cor);
  const observacao = normalizeValue(input.observacao);

  if (!produto) {
    throw new Error("Produto é obrigatório.");
  }

  if (!hasPostgres()) {
    const rows = readCurvaAbcObservacoesFile();
    const key = makeCompositeKey(input.company, produto, cor);
    const nowIso = new Date().toISOString();
    const filtered = rows.filter((row) => makeCompositeKey(row.company, row.produto, row.cor) !== key);

    if (!observacao) {
      writeCurvaAbcObservacoesFile(filtered);
      return null;
    }

    const existing = rows.find((row) => makeCompositeKey(row.company, row.produto, row.cor) === key);
    const record: CurvaAbcObservacaoRecord = {
      company: input.company,
      produto,
      cor,
      observacao,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    writeCurvaAbcObservacoesFile([...filtered, record]);
    return record;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  if (!observacao) {
    await sql`
      DELETE FROM curva_abc_observacoes
      WHERE company = ${input.company}
        AND produto = ${produto}
        AND cor = ${cor}
    `;
    return null;
  }

  const rows = await sql`
    INSERT INTO curva_abc_observacoes (company, produto, cor, observacao, updated_at)
    VALUES (${input.company}, ${produto}, ${cor}, ${observacao}, NOW())
    ON CONFLICT (company, produto, cor) DO UPDATE SET
      observacao = EXCLUDED.observacao,
      updated_at = NOW()
    RETURNING company, produto, cor, observacao, created_at, updated_at
  `;

  const row = rows[0];
  return {
    company: row.company as CompanyKey,
    produto: normalizeValue(row.produto),
    cor: normalizeValue(row.cor),
    observacao: normalizeValue(row.observacao),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
