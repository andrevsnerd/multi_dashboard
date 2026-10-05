/**
 * Trava de inventário por filial — aplicada MANUALMENTE pelo admin (página Romaneios).
 *
 * Cada linha diz: na filial X, romaneio com data ANTERIOR a `data_corte` não se
 * confirma mais (só consulta). Fica até o admin remover/alterar. Ver
 * lib/server/trava-inventario.ts para a regra.
 *
 * Usa o banco Neon (Postgres), com fallback em arquivo — nunca o Linx. Leitura
 * em cache de memória curto, invalidado em toda gravação.
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "trava-inventario.json");
const CACHE_TTL_MS = 60_000;

export interface TravaInventarioFilial {
  companyKey: string;
  /** FILIAIS.FILIAL (nome) da filial travada. */
  filial: string;
  /** COD_FILIAL, quando conhecido — a tela às vezes manda o código. */
  codFilial: string | null;
  /** YYYY-MM-DD: romaneio com data menor que esta fica só consulta. */
  dataCorte: string;
  /** Inventário que originou a trava (ex.: INVNERDMORUMBIRDRRRJ0210). */
  inventarioNome: string | null;
  aplicadoPor: string | null;
  atualizadoEm: string | null;
}

let tableChecked = false;
const cache = new Map<string, { at: number; travas: TravaInventarioFilial[] }>();

function companyNorm(companyKey: string): string {
  return (companyKey || "").trim().toLowerCase();
}

// ---------- Fallback em arquivo ----------
function readFile(): TravaInventarioFilial[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFile(records: TravaInventarioFilial[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

// ---------- Neon ----------
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS trava_inventario_filial (
      company_key TEXT NOT NULL,
      filial TEXT NOT NULL,
      cod_filial TEXT,
      data_corte TEXT NOT NULL,
      inventario_nome TEXT,
      aplicado_por TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (company_key, filial)
    )
  `;
  tableChecked = true;
}

/** Travas ativas da empresa. */
export async function getTravasInventario(companyKey: string): Promise<TravaInventarioFilial[]> {
  const c = companyNorm(companyKey);
  const hit = cache.get(c);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.travas;

  let travas: TravaInventarioFilial[];
  if (!hasPostgres()) {
    travas = readFile().filter((t) => companyNorm(t.companyKey) === c);
  } else {
    const sql = getNeonSql();
    await ensureTable(sql);
    const rows = await sql`
      SELECT company_key, filial, cod_filial, data_corte, inventario_nome, aplicado_por, updated_at
        FROM trava_inventario_filial
       WHERE company_key = ${c}
       ORDER BY filial
    `;
    travas = rows.map((r) => ({
      companyKey: String(r.company_key),
      filial: String(r.filial),
      codFilial: r.cod_filial != null ? String(r.cod_filial) : null,
      dataCorte: String(r.data_corte),
      inventarioNome: r.inventario_nome != null ? String(r.inventario_nome) : null,
      aplicadoPor: r.aplicado_por != null ? String(r.aplicado_por) : null,
      atualizadoEm: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
    }));
  }

  cache.set(c, { at: Date.now(), travas });
  return travas;
}

/** Aplica (ou altera) a trava de uma filial. */
export async function setTravaInventario(
  trava: Omit<TravaInventarioFilial, "atualizadoEm">
): Promise<void> {
  const c = companyNorm(trava.companyKey);
  const filial = trava.filial.trim();
  cache.delete(c);

  if (!hasPostgres()) {
    const records = readFile().filter(
      (t) => !(companyNorm(t.companyKey) === c && t.filial.trim() === filial)
    );
    records.push({ ...trava, companyKey: c, filial, atualizadoEm: new Date().toISOString() });
    writeFile(records);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO trava_inventario_filial
      (company_key, filial, cod_filial, data_corte, inventario_nome, aplicado_por, updated_at)
    VALUES
      (${c}, ${filial}, ${trava.codFilial}, ${trava.dataCorte}, ${trava.inventarioNome}, ${trava.aplicadoPor}, NOW())
    ON CONFLICT (company_key, filial) DO UPDATE SET
      cod_filial = EXCLUDED.cod_filial,
      data_corte = EXCLUDED.data_corte,
      inventario_nome = EXCLUDED.inventario_nome,
      aplicado_por = EXCLUDED.aplicado_por,
      updated_at = NOW()
  `;
}

/** Remove a trava de uma filial (romaneios voltam a poder ser confirmados). */
export async function removerTravaInventario(companyKey: string, filial: string): Promise<void> {
  const c = companyNorm(companyKey);
  const f = filial.trim();
  cache.delete(c);

  if (!hasPostgres()) {
    writeFile(readFile().filter((t) => !(companyNorm(t.companyKey) === c && t.filial.trim() === f)));
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`DELETE FROM trava_inventario_filial WHERE company_key = ${c} AND filial = ${f}`;
}
