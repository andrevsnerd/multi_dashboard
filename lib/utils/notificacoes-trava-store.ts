/**
 * Armazenamento do prazo (dias mínimos) da TRAVA de confirmação de entradas,
 * por empresa. Cada empresa pode ter sua própria carência editável no admin.
 *
 * Usa o banco Neon (Postgres) com fallback em arquivo JSON, espelhando o padrão
 * de destino-romaneio-store. Quando não há valor salvo para a empresa, cai no
 * default TRAVA_DIAS_MINIMOS (lib/config/notificacoes-trava.ts).
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import { TRAVA_DIAS_MINIMOS } from "@/lib/config/notificacoes-trava";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "notificacao-trava-prazo.json");

let tableChecked = false;

/** Limites de sanidade para o prazo (em dias). */
export const TRAVA_DIAS_MIN = 1;
export const TRAVA_DIAS_MAX = 90;

function normCompany(companyKey: string): string {
  return (companyKey || "").trim().toLowerCase();
}

/** Garante um inteiro dentro dos limites; cai no default se inválido. */
function sanitizeDias(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return TRAVA_DIAS_MINIMOS;
  return Math.min(TRAVA_DIAS_MAX, Math.max(TRAVA_DIAS_MIN, n));
}

// ---------- Fallback em arquivo ----------
type FileRecord = Record<string, number>;

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFile(): FileRecord {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeFile(records: FileRecord) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

// ---------- Neon ----------
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS notificacao_trava_prazo (
      company_key TEXT PRIMARY KEY,
      dias_minimos INTEGER NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

/**
 * Retorna o prazo (dias mínimos) configurado para a empresa, ou o default
 * TRAVA_DIAS_MINIMOS quando não há valor salvo.
 */
export async function getDiasMinimos(companyKey: string): Promise<number> {
  const c = normCompany(companyKey);
  if (!c) return TRAVA_DIAS_MINIMOS;

  if (!hasPostgres()) {
    const records = readFile();
    return c in records ? sanitizeDias(records[c]) : TRAVA_DIAS_MINIMOS;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT dias_minimos FROM notificacao_trava_prazo WHERE company_key = ${c} LIMIT 1
  `;
  if (result.length === 0) return TRAVA_DIAS_MINIMOS;
  return sanitizeDias(result[0].dias_minimos);
}

/**
 * Retorna o prazo configurado de várias empresas de uma vez (mapa
 * company_key -> dias). Empresas sem valor salvo recebem o default.
 */
export async function getAllDiasMinimos(companyKeys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const key of companyKeys) out[normCompany(key)] = TRAVA_DIAS_MINIMOS;

  if (!hasPostgres()) {
    const records = readFile();
    for (const key of Object.keys(out)) {
      if (key in records) out[key] = sanitizeDias(records[key]);
    }
    return out;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  const result = await sql`SELECT company_key, dias_minimos FROM notificacao_trava_prazo`;
  for (const row of result) {
    const c = normCompany(String(row.company_key));
    if (c in out) out[c] = sanitizeDias(row.dias_minimos);
  }
  return out;
}

/**
 * Salva o prazo (dias mínimos) da trava para a empresa. Valor é saneado para
 * o intervalo [TRAVA_DIAS_MIN, TRAVA_DIAS_MAX].
 */
export async function setDiasMinimos(companyKey: string, dias: number): Promise<number> {
  const c = normCompany(companyKey);
  if (!c) throw new Error("company_key inválido");
  const value = sanitizeDias(dias);

  if (!hasPostgres()) {
    const records = readFile();
    records[c] = value;
    writeFile(records);
    return value;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO notificacao_trava_prazo (company_key, dias_minimos, updated_at)
    VALUES (${c}, ${value}, NOW())
    ON CONFLICT (company_key) DO UPDATE SET
      dias_minimos = EXCLUDED.dias_minimos,
      updated_at = NOW()
  `;
  return value;
}
