/**
 * Armazenamento da filial destino por romaneio de saída (cada romaneio tem seu próprio destino).
 * Usa o banco Neon (Postgres). Apenas usuários com permissão "destino-romaneio" (ou admin) podem definir.
 */

import { hasPostgres } from "@/lib/db/neon";
import { getNeonSql } from "@/lib/db/neon";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "destino-romaneio.json");

let tableChecked = false;

// ---------- Fallback em arquivo ----------
interface FileRecord {
  company_key: string;
  romaneio_id: string;
  filial_origem: string;
  filial_destino: string;
}

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFile(): FileRecord[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFile(records: FileRecord[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

function key(companyKey: string, romaneioId: string, filialOrigem: string) {
  return `${(companyKey || "").trim().toLowerCase()}|${(romaneioId || "").trim()}|${(filialOrigem || "").trim()}`;
}

// ---------- Neon ----------
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS destino_romaneio_saida (
      company_key TEXT NOT NULL,
      romaneio_id TEXT NOT NULL,
      filial_origem TEXT NOT NULL,
      filial_destino TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (company_key, romaneio_id, filial_origem)
    )
  `;
  tableChecked = true;
}

/**
 * Retorna a filial destino salva para este romaneio de saída, ou null.
 */
export async function getDestinoRomaneio(
  companyKey: string,
  romaneioId: string,
  filialOrigem: string
): Promise<string | null> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const o = (filialOrigem || "").trim();

  if (!hasPostgres()) {
    const records = readFile();
    const rec = records.find(
      (x) =>
        x.company_key.toLowerCase() === c &&
        x.romaneio_id === r &&
        x.filial_origem === o
    );
    return rec?.filial_destino ?? null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT filial_destino
    FROM destino_romaneio_saida
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_origem = ${o}
    LIMIT 1
  `;

  if (result.length === 0) return null;
  const value = result[0].filial_destino;
  return value != null ? String(value).trim() : null;
}

/**
 * Retorna mapa de destino por romaneio (chave: romaneioId|filialOrigem, valor: filialDestino) para a empresa.
 */
export async function getAllDestinosByCompany(
  companyKey: string
): Promise<Map<string, string>> {
  const c = (companyKey || "").trim().toLowerCase();
  const map = new Map<string, string>();

  if (!hasPostgres()) {
    const records = readFile();
    for (const r of records) {
      if (r.company_key.toLowerCase() !== c) continue;
      const key = `${r.romaneio_id}|${r.filial_origem}`;
      map.set(key, r.filial_destino.trim());
    }
    return map;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT romaneio_id, filial_origem, filial_destino
    FROM destino_romaneio_saida
    WHERE company_key = ${c}
  `;

  for (const row of result) {
    const rId = row.romaneio_id != null ? String(row.romaneio_id).trim() : "";
    const fo = row.filial_origem != null ? String(row.filial_origem).trim() : "";
    const fd = row.filial_destino != null ? String(row.filial_destino).trim() : "";
    if (rId) map.set(`${rId}|${fo}`, fd);
  }
  return map;
}

/**
 * Salva a filial destino para este romaneio de saída.
 */
export async function setDestinoRomaneio(
  companyKey: string,
  romaneioId: string,
  filialOrigem: string,
  filialDestino: string
): Promise<void> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const o = (filialOrigem || "").trim();
  const d = (filialDestino || "").trim();

  if (!hasPostgres()) {
    const records = readFile();
    const k = key(companyKey, romaneioId, filialOrigem);
    const idx = records.findIndex(
      (x) => key(x.company_key, x.romaneio_id, x.filial_origem) === k
    );
    const newRecord: FileRecord = { company_key: c, romaneio_id: r, filial_origem: o, filial_destino: d };
    if (idx >= 0) records[idx] = newRecord;
    else records.push(newRecord);
    writeFile(records);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    INSERT INTO destino_romaneio_saida (company_key, romaneio_id, filial_origem, filial_destino, updated_at)
    VALUES (${c}, ${r}, ${o}, ${d}, NOW())
    ON CONFLICT (company_key, romaneio_id, filial_origem) DO UPDATE SET
      filial_destino = EXCLUDED.filial_destino,
      updated_at = NOW()
  `;
}
