import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

/**
 * Persistência da DATA DE COMPRA do ciclo (modo ciclo da Compra Ideal).
 *
 * A data funciona como CATRACA: só anda para MAIS CEDO. Se o produto acelera, a data
 * recalculada fica mais cedo e a catraca avança (grava a nova). Se desacelera, a data
 * recalculada ficaria mais tarde — a catraca SEGURA a data mais cedo já registrada e só a
 * quantidade é atualizada. A catraca é zerada (novo ciclo) quando entra trânsito novo pro
 * item — detectado pela "assinatura de trânsito" (`transitoSig` = maior `confirmedAt` das
 * compras em trânsito do item). Quando a assinatura muda, a data é re-baseada na recalculada.
 *
 * Mesma estratégia de armazenamento da Compra Salva: Neon quando disponível, com fallback
 * em arquivo JSON em data/.
 */

export interface CompraDataFixaEntry {
  /** Chave do item (buildControleEstoqueItemKey: produto||cor). */
  itemKey: string;
  /** Data de compra atual da catraca (ISO yyyy-mm-dd) — a mais cedo registrada no ciclo. */
  dataCompra: string;
  /** Assinatura do trânsito do ciclo (maior confirmedAt, "" se sem trânsito). */
  transitoSig: string;
  updatedAt: string;
}

export interface CompraDataFixaUpsert {
  itemKey: string;
  dataCompra: string;
  transitoSig: string;
}

type FileShape = Record<string, CompraDataFixaEntry[]>; // chave = `${companyKey}::${filial}`

const FILE_PATH = path.join(process.cwd(), "data", "compra-data-fixa.json");

let tableChecked = false;

function bucketKey(companyKey: string, filial: string): string {
  return `${companyKey}::${filial}`;
}

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
    CREATE TABLE IF NOT EXISTS compra_data_fixa (
      company_key TEXT NOT NULL,
      filial TEXT NOT NULL,
      item_key TEXT NOT NULL,
      data_compra TEXT NOT NULL,
      transito_sig TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_key, filial, item_key)
    )
  `;
  tableChecked = true;
}

async function readFileAll(): Promise<FileShape> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as FileShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeFileAll(data: FileShape) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/** Datas de compra de um contexto (empresa+filial), indexadas por itemKey. */
export async function getComprasDataFixa(
  companyKey: string,
  filial: string
): Promise<Record<string, CompraDataFixaEntry>> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT item_key, data_compra, transito_sig, updated_at
      FROM compra_data_fixa
      WHERE company_key = ${companyKey} AND filial = ${filial}
    `;
    const out: Record<string, CompraDataFixaEntry> = {};
    for (const r of rows as Array<{
      item_key: string;
      data_compra: string;
      transito_sig: string;
      updated_at: Date | string;
    }>) {
      out[r.item_key] = {
        itemKey: r.item_key,
        dataCompra: String(r.data_compra).slice(0, 10),
        transitoSig: r.transito_sig ?? "",
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    }
    return out;
  }

  const all = await readFileAll();
  const list = all[bucketKey(companyKey, filial)] ?? [];
  const out: Record<string, CompraDataFixaEntry> = {};
  for (const e of list) out[e.itemKey] = e;
  return out;
}

/**
 * Grava/atualiza um lote de datas da catraca. Usado quando a data avança pra mais cedo
 * (aceleração) ou quando o ciclo é re-baseado (trânsito novo). Desaceleração não chama isto.
 */
export async function upsertComprasDataFixa(
  companyKey: string,
  filial: string,
  entries: CompraDataFixaUpsert[]
): Promise<number> {
  const valid = entries.filter((e) => e.itemKey && e.dataCompra);
  if (valid.length === 0) return 0;
  const now = new Date().toISOString();

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    for (const e of valid) {
      await sql`
        INSERT INTO compra_data_fixa (company_key, filial, item_key, data_compra, transito_sig, updated_at)
        VALUES (${companyKey}, ${filial}, ${e.itemKey}, ${e.dataCompra}, ${e.transitoSig ?? ""}, ${now})
        ON CONFLICT (company_key, filial, item_key)
        DO UPDATE SET data_compra = EXCLUDED.data_compra,
                      transito_sig = EXCLUDED.transito_sig,
                      updated_at = EXCLUDED.updated_at
      `;
    }
    return valid.length;
  }

  const all = await readFileAll();
  const key = bucketKey(companyKey, filial);
  const list = all[key] ?? [];
  const byItem = new Map(list.map((e) => [e.itemKey, e]));
  for (const e of valid) {
    byItem.set(e.itemKey, {
      itemKey: e.itemKey,
      dataCompra: e.dataCompra,
      transitoSig: e.transitoSig ?? "",
      updatedAt: now,
    });
  }
  all[key] = Array.from(byItem.values());
  await writeFileAll(all);
  return valid.length;
}
