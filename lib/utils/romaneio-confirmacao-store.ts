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
  /**
   * Romaneio de ENTRADA gerado no destino quando o item foi confirmado.
   *
   * Sem isso não há como corrigir o estoque do destino depois: a entrada criada
   * na confirmação é um romaneio avulso, que no Linx não guarda nenhuma ligação
   * com a saída (nem FILIAL_ORIGEM, nem ROMANEIO_DESTINO). Vazio nas
   * confirmações anteriores a 23/09/2026 — aí a correção do destino só pode
   * sair por ajuste de estoque (ver a tela Defeitos).
   */
  romaneio_entrada?: string;
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
  await sql`ALTER TABLE romaneio_item_confirmado ADD COLUMN IF NOT EXISTS romaneio_entrada TEXT NOT NULL DEFAULT ''`;
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
 *
 * `romaneioEntrada` é o romaneio de entrada gerado no destino nesta confirmação.
 * Vazio não apaga o que já estiver gravado: reconfirmar um item não deve fazer o
 * sistema perder de vista a entrada que ele criou.
 */
export async function confirmarItem(
  companyKey: string,
  romaneioId: string,
  filialDestino: string,
  produto: string,
  corProduto: string,
  qtdeConfirmada: number,
  confirmedBy: string,
  romaneioEntrada?: string
): Promise<void> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const p = (produto || "").trim();
  const cor = (corProduto || "").trim();
  const qtde = Math.max(0, Math.round(qtdeConfirmada));
  const by = (confirmedBy || "").trim();
  const romEnt = (romaneioEntrada || "").trim();

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
      romaneio_entrada: romEnt || records[idx]?.romaneio_entrada || "",
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
      (company_key, romaneio_id, filial_destino, produto, cor_produto, qtde_confirmada, confirmed_at, confirmed_by, romaneio_entrada)
    VALUES
      (${c}, ${r}, ${fd}, ${p}, ${cor}, ${qtde}, NOW(), ${by}, ${romEnt})
    ON CONFLICT (company_key, romaneio_id, filial_destino, produto, cor_produto)
    DO UPDATE SET
      qtde_confirmada = ${qtde},
      confirmed_at = NOW(),
      confirmed_by = ${by},
      romaneio_entrada = COALESCE(NULLIF(${romEnt}, ''), romaneio_item_confirmado.romaneio_entrada)
  `;
}

/**
 * Uma confirmação específica, com a quantidade e o romaneio de entrada gerado.
 * É o que a tela Defeitos consulta antes de corrigir um item: só assim ela sabe
 * se o destino já recebeu a peça (e em qual romaneio) ou se a correção mexe
 * apenas na saída.
 */
export async function getConfirmacaoItem(
  companyKey: string,
  romaneioId: string,
  filialDestino: string,
  produto: string,
  corProduto: string
): Promise<{ qtdeConfirmada: number; romaneioEntrada: string } | null> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const p = (produto || "").trim();
  const cor = (corProduto || "").trim();

  if (!hasPostgres()) {
    const k = itemKey(r, fd, p, cor);
    const rec = readFile().find(
      (x) =>
        x.company_key.toLowerCase() === c &&
        itemKey(x.romaneio_id, x.filial_destino, x.produto, x.cor_produto) === k
    );
    return rec
      ? { qtdeConfirmada: rec.qtde_confirmada ?? 0, romaneioEntrada: rec.romaneio_entrada ?? "" }
      : null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT qtde_confirmada, romaneio_entrada
    FROM romaneio_item_confirmado
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}
      AND produto = ${p} AND cor_produto = ${cor}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    qtdeConfirmada: Number(row.qtde_confirmada) || 0,
    romaneioEntrada: (row.romaneio_entrada ?? "").toString().trim(),
  };
}

/**
 * Por romaneio: quanta peça foi confirmada e em quantas linhas, para UMA filial
 * de destino. Uma consulta agregada para a lista inteira — a tela Defeitos mostra
 * centenas de romaneios e uma leitura por romaneio faria centenas de idas ao Neon.
 */
export async function getConfirmadoAgregadoPorRomaneio(
  companyKey: string,
  filialDestino: string
): Promise<Map<string, { qtde: number; linhas: number }>> {
  const c = (companyKey || "").trim().toLowerCase();
  const fd = (filialDestino || "").trim();
  const mapa = new Map<string, { qtde: number; linhas: number }>();

  const acumular = (romaneio: string, qtde: number) => {
    if (qtde <= 0) return;
    const chave = (romaneio || "").trim();
    const atual = mapa.get(chave) ?? { qtde: 0, linhas: 0 };
    atual.qtde += qtde;
    atual.linhas += 1;
    mapa.set(chave, atual);
  };

  if (!hasPostgres()) {
    for (const rec of readFile()) {
      if (rec.company_key.toLowerCase() !== c || rec.filial_destino.trim() !== fd) continue;
      acumular(rec.romaneio_id, rec.qtde_confirmada ?? 0);
    }
    return mapa;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT romaneio_id,
           SUM(qtde_confirmada) AS qtde,
           COUNT(*) AS linhas
    FROM romaneio_item_confirmado
    WHERE company_key = ${c} AND filial_destino = ${fd} AND qtde_confirmada > 0
    GROUP BY romaneio_id
  `;

  for (const row of rows) {
    mapa.set((row.romaneio_id ?? "").toString().trim(), {
      qtde: Number(row.qtde) || 0,
      linhas: Number(row.linhas) || 0,
    });
  }
  return mapa;
}

/**
 * Confirmações de um romaneio com o romaneio de entrada de cada item — o que a
 * tela Defeitos precisa para saber, item por item, se o destino já recebeu a
 * peça e por qual romaneio corrigi-la.
 */
export async function getConfirmadosComEntrada(
  companyKey: string,
  romaneioId: string,
  filialDestino: string
): Promise<Map<string, { qtde: number; romaneioEntrada: string }>> {
  const c = (companyKey || "").trim().toLowerCase();
  const r = (romaneioId || "").trim();
  const fd = (filialDestino || "").trim();
  const mapa = new Map<string, { qtde: number; romaneioEntrada: string }>();

  if (!hasPostgres()) {
    for (const rec of readFile()) {
      if (
        rec.company_key.toLowerCase() === c &&
        rec.romaneio_id === r &&
        rec.filial_destino === fd
      ) {
        mapa.set(`${rec.produto}|${rec.cor_produto ?? ""}`, {
          qtde: rec.qtde_confirmada ?? 0,
          romaneioEntrada: rec.romaneio_entrada ?? "",
        });
      }
    }
    return mapa;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT produto, cor_produto, qtde_confirmada, romaneio_entrada
    FROM romaneio_item_confirmado
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}
  `;

  for (const row of rows) {
    mapa.set(`${row.produto}|${row.cor_produto ?? ""}`, {
      qtde: Number(row.qtde_confirmada) || 0,
      romaneioEntrada: (row.romaneio_entrada ?? "").toString().trim(),
    });
  }
  return mapa;
}

/** Item confirmado como a tela Defeitos precisa ler: chave + quantidade + quando. */
export interface ConfirmacaoDetalhada {
  romaneioId: string;
  produto: string;
  corProduto: string;
  qtdeConfirmada: number;
  confirmedAt: string;
  confirmedBy: string;
  romaneioEntrada: string;
}

/**
 * Todas as confirmações de uma filial de destino num período, pela DATA DA
 * CONFIRMAÇÃO — o instante em que a peça de fato entrou naquela filial.
 *
 * É a fonte do painel de entradas da tela Defeitos: o romaneio de entrada criado
 * no destino não guarda a loja de origem, então a única forma de dizer de onde a
 * peça veio é partir da confirmação e voltar ao romaneio de saída.
 */
export async function getConfirmacoesPorPeriodo(
  companyKey: string,
  filialDestino: string,
  range: { start: Date; end: Date }
): Promise<ConfirmacaoDetalhada[]> {
  const c = (companyKey || "").trim().toLowerCase();
  const fd = (filialDestino || "").trim();

  const mapear = (rec: {
    romaneio_id: string;
    produto: string;
    cor_produto: string | null;
    qtde_confirmada: number | null;
    confirmed_at: string | Date;
    confirmed_by: string | null;
    romaneio_entrada?: string | null;
  }): ConfirmacaoDetalhada => ({
    romaneioId: (rec.romaneio_id ?? "").toString().trim(),
    produto: (rec.produto ?? "").toString().trim(),
    corProduto: (rec.cor_produto ?? "").toString().trim(),
    qtdeConfirmada: Number(rec.qtde_confirmada) || 0,
    confirmedAt: new Date(rec.confirmed_at).toISOString(),
    confirmedBy: (rec.confirmed_by ?? "").toString().trim(),
    romaneioEntrada: (rec.romaneio_entrada ?? "").toString().trim(),
  });

  if (!hasPostgres()) {
    return readFile()
      .filter(
        (rec) =>
          rec.company_key.toLowerCase() === c &&
          rec.filial_destino.trim() === fd &&
          new Date(rec.confirmed_at) >= range.start &&
          new Date(rec.confirmed_at) < range.end
      )
      .map(mapear);
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT romaneio_id, produto, cor_produto, qtde_confirmada,
           confirmed_at, confirmed_by, romaneio_entrada
    FROM romaneio_item_confirmado
    WHERE company_key = ${c}
      AND filial_destino = ${fd}
      AND confirmed_at >= ${range.start.toISOString()}
      AND confirmed_at < ${range.end.toISOString()}
      AND qtde_confirmada > 0
    ORDER BY confirmed_at DESC
  `;

  return rows.map((row) => mapear(row as Parameters<typeof mapear>[0]));
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
