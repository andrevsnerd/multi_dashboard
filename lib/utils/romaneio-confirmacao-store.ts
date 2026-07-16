/**
 * Armazenamento de confirmações de itens recebidos em romaneios de entrada.
 * Quando uma filial clica em "DAR ENTRADA" em um item do romaneio, grava aqui
 * junto com a quantidade real recebida (pode diferir da quantidade do romaneio).
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "romaneio-confirmacoes.json");

let tableChecked = false;

// ---------- Tipos ----------

export interface ConfirmacaoItem {
  company_key: string;
  romaneio_id: string;
  filial_destino: string;
  produto: string;
  cor_produto: string;
  qtde_confirmada: number;
  confirmed_at: string;
  confirmed_by: string;
}

/** Mapa de "produto|cor" -> qtde_confirmada para um romaneio+filialDestino. */
export type ConfirmadosMap = Map<string, number>;

// Chave única por item
function itemKey(romaneioId: string, filialDestino: string, produto: string, corProduto: string) {
  return `${romaneioId}|${filialDestino}|${produto}|${corProduto ?? ""}`;
}

// ---------- Fallback em arquivo ----------
function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFile(): ConfirmacaoItem[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFile(records: ConfirmacaoItem[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

// ---------- Neon ----------
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS romaneio_item_confirmado (
      company_key    TEXT NOT NULL,
      romaneio_id    TEXT NOT NULL,
      filial_destino TEXT NOT NULL,
      produto        TEXT NOT NULL,
      cor_produto    TEXT NOT NULL DEFAULT '',
      qtde_confirmada INTEGER NOT NULL DEFAULT 0,
      confirmed_at   TIMESTAMPTZ DEFAULT NOW(),
      confirmed_by   TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (company_key, romaneio_id, filial_destino, produto, cor_produto)
    )
  `;
  // Garante coluna nova em tabelas já existentes
  await sql`ALTER TABLE romaneio_item_confirmado ADD COLUMN IF NOT EXISTS qtde_confirmada INTEGER NOT NULL DEFAULT 0`;
  tableChecked = true;
}

/**
 * Retorna mapa de "romaneioId|filialDestino" → quantidade de itens confirmados,
 * para todos os romaneios de uma empresa. Usado para indicador na listagem.
 *
 * `sinceDays` (opcional): quando informado, considera apenas confirmações dos
 * últimos N dias (via `confirmed_at`). Usado pelo polling de notificações —
 * que só olha saídas recentes — para não fazer GROUP BY sobre a tabela inteira
 * a cada request e estourar a cota de transferência do Neon.
 * Omitido = comportamento original (todas as confirmações da empresa).
 */
export async function getContadorConfirmadosByCompany(
  companyKey: string,
  sinceDays?: number
): Promise<Map<string, number>> {
  const c = (companyKey || "").trim().toLowerCase();
  const counter: Map<string, number> = new Map();

  if (!hasPostgres()) {
    const records = readFile();
    for (const rec of records) {
      if (rec.company_key.toLowerCase() !== c) continue;
      const k = `${rec.romaneio_id}|${rec.filial_destino}`;
      counter.set(k, (counter.get(k) ?? 0) + 1);
    }
    return counter;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows =
    sinceDays && sinceDays > 0
      ? await sql`
          SELECT romaneio_id, filial_destino, COUNT(*) AS cnt
          FROM romaneio_item_confirmado
          WHERE company_key = ${c}
            AND confirmed_at >= ${new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()}
          GROUP BY romaneio_id, filial_destino
        `
      : await sql`
          SELECT romaneio_id, filial_destino, COUNT(*) AS cnt
          FROM romaneio_item_confirmado
          WHERE company_key = ${c}
          GROUP BY romaneio_id, filial_destino
        `;

  for (const row of rows) {
    const k = `${row.romaneio_id}|${row.filial_destino}`;
    counter.set(k, Number(row.cnt));
  }
  return counter;
}

/**
 * Retorna mapa de "produto|cor" → qtde_confirmada para um romaneio+filialDestino.
 */
export async function getConfirmados(
  companyKey: string,
  romaneioId: string,
  filialDestino: string
): Promise<ConfirmadosMap> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const map: ConfirmadosMap = new Map();

  if (!hasPostgres()) {
    const records = readFile();
    for (const rec of records) {
      if (
        rec.company_key.toLowerCase() === c &&
        rec.romaneio_id === r &&
        rec.filial_destino === fd
      ) {
        map.set(`${rec.produto}|${rec.cor_produto ?? ""}`, rec.qtde_confirmada ?? 0);
      }
    }
    return map;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT produto, cor_produto, qtde_confirmada
    FROM romaneio_item_confirmado
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}
  `;

  for (const row of rows) {
    map.set(`${row.produto}|${row.cor_produto ?? ""}`, row.qtde_confirmada ?? 0);
  }
  return map;
}

/**
 * Confirma (adiciona ou atualiza) um item como recebido com a quantidade real.
 */
export async function confirmarItem(
  companyKey: string,
  romaneioId: string,
  filialDestino: string,
  produto: string,
  corProduto: string,
  qtdeConfirmada: number,
  confirmedBy: string
): Promise<void> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const p = (produto || "").trim();
  const cor = (corProduto || "").trim();
  const qtde = Math.max(0, Math.round(qtdeConfirmada));
  const by = (confirmedBy || "").trim();

  if (!hasPostgres()) {
    const records = readFile();
    const k = itemKey(r, fd, p, cor);
    const idx = records.findIndex(
      (x) =>
        itemKey(x.romaneio_id, x.filial_destino, x.produto, x.cor_produto) === k &&
        x.company_key.toLowerCase() === c
    );
    const newRec: ConfirmacaoItem = {
      company_key: c,
      romaneio_id: r,
      filial_destino: fd,
      produto: p,
      cor_produto: cor,
      qtde_confirmada: qtde,
      confirmed_at: new Date().toISOString(),
      confirmed_by: by,
    };
    if (idx >= 0) records[idx] = newRec;
    else records.push(newRec);
    writeFile(records);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    INSERT INTO romaneio_item_confirmado
      (company_key, romaneio_id, filial_destino, produto, cor_produto, qtde_confirmada, confirmed_at, confirmed_by)
    VALUES
      (${c}, ${r}, ${fd}, ${p}, ${cor}, ${qtde}, NOW(), ${by})
    ON CONFLICT (company_key, romaneio_id, filial_destino, produto, cor_produto)
    DO UPDATE SET
      qtde_confirmada = ${qtde},
      confirmed_at = NOW(),
      confirmed_by = ${by}
  `;
}

/**
 * Remove a confirmação de um item (desmarcar).
 */
export async function desconfirmarItem(
  companyKey: string,
  romaneioId: string,
  filialDestino: string,
  produto: string,
  corProduto: string
): Promise<void> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const p = (produto || "").trim();
  const cor = (corProduto || "").trim();

  if (!hasPostgres()) {
    const records = readFile();
    const k = itemKey(r, fd, p, cor);
    const filtered = records.filter(
      (x) =>
        !(
          itemKey(x.romaneio_id, x.filial_destino, x.produto, x.cor_produto) === k &&
          x.company_key.toLowerCase() === c
        )
    );
    writeFile(filtered);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    DELETE FROM romaneio_item_confirmado
    WHERE company_key = ${c}
      AND romaneio_id = ${r}
      AND filial_destino = ${fd}
      AND produto = ${p}
      AND cor_produto = ${cor}
  `;
}
