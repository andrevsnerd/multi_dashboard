import type { ProjecaoCategoria } from '@/lib/repositories/controleEstoque';
import { hasPostgres, getNeonSql } from '@/lib/db/neon';

export interface ProjecaoHistoricoRow {
  id: number;
  snapshot_date: Date;
  company: string;
  filial: string | null;
  categoria: string;
  linha: string | null;
  subgrupo: string | null;
  grade: string | null;
  colecao: string | null;
  ano: number;
  mes: number;
  vendas_projetada: number;
  vendas_real: number | null;
  estoque_projetado: number;
  estoque_real: number | null;
  duracao_projetada: number;
  duracao_real: number | null;
  created_at: Date;
}

let tableChecked = false;

/**
 * Garante que a tabela projecao_estoque_historico existe (Neon/Postgres).
 */
async function ensureTable() {
  if (tableChecked) return;
  if (!hasPostgres()) {
    throw new Error('Neon/Postgres não configurado (veja variáveis em lib/db/neon.ts).');
  }
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS projecao_estoque_historico (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      company TEXT NOT NULL,
      filial TEXT NULL,
      categoria TEXT NOT NULL,
      linha TEXT NULL,
      subgrupo TEXT NULL,
      grade TEXT NULL,
      colecao TEXT NULL,
      ano INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      vendas_projetada INTEGER NOT NULL,
      vendas_real INTEGER NULL,
      estoque_projetado INTEGER NOT NULL,
      estoque_real INTEGER NULL,
      duracao_projetada INTEGER NOT NULL,
      duracao_real INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

/**
 * Salva um snapshot da projeção de estoque.
 * Estoque e duração real: apenas no mês atual; nos demais meses ficam null.
 */
export async function saveProjecaoSnapshot(
  snapshotDate: Date,
  company: string,
  filial: string | null,
  data: ProjecaoCategoria[]
): Promise<{ saved: number }> {
  await ensureTable();
  const sql = getNeonSql();
  const dateStr = snapshotDate.toISOString().slice(0, 10);
  let saved = 0;

  for (const cat of data) {
    for (const mes of cat.meses) {
      const estoqueReal = mes.isMesAtual ? mes.estoque : null;
      const duracaoReal = mes.isMesAtual ? mes.duracao : null;
      await sql`
        INSERT INTO projecao_estoque_historico (
          snapshot_date, company, filial, categoria, linha, subgrupo, grade, colecao,
          ano, mes, vendas_projetada, vendas_real, estoque_projetado, estoque_real,
          duracao_projetada, duracao_real
        ) VALUES (
          ${dateStr},
          ${company},
          ${filial},
          ${cat.categoria},
          ${cat.linha ?? null},
          ${cat.subgrupo ?? null},
          ${cat.grade ?? null},
          ${cat.colecao ?? null},
          ${mes.ano},
          ${mes.mesNumero},
          ${mes.vendas},
          ${mes.vendasReais ?? null},
          ${mes.estoque},
          ${estoqueReal},
          ${mes.duracao},
          ${duracaoReal}
        )
      `;
      saved++;
    }
  }

  return { saved };
}

/**
 * Lista as datas de snapshot disponíveis.
 */
export async function fetchSnapshotDates(
  company: string,
  filial: string | null
): Promise<{ snapshot_date: string }[]> {
  await ensureTable();
  const sql = getNeonSql();
  const rows = await sql`
    SELECT DISTINCT TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS snapshot_date
    FROM projecao_estoque_historico
    WHERE company = ${company}
      AND (${filial ?? ''} = '' OR filial = ${filial} OR (filial IS NULL AND ${filial ?? ''} = ''))
    ORDER BY snapshot_date DESC
  ` as { snapshot_date: string }[];
  return rows;
}

/**
 * Busca todos os dados de um snapshot.
 */
export async function fetchHistoricoBySnapshot(
  company: string,
  snapshotDate: string,
  filial: string | null
): Promise<ProjecaoHistoricoRow[]> {
  await ensureTable();
  const sql = getNeonSql();
  const rows = await sql`
    SELECT
      id, snapshot_date, company, filial, categoria, linha, subgrupo, grade, colecao,
      ano, mes, vendas_projetada, vendas_real, estoque_projetado, estoque_real,
      duracao_projetada, duracao_real, created_at
    FROM projecao_estoque_historico
    WHERE company = ${company}
      AND snapshot_date = ${snapshotDate}
      AND (${filial ?? ''} = '' OR filial = ${filial} OR (filial IS NULL AND ${filial ?? ''} = ''))
    ORDER BY categoria, linha, subgrupo, grade, colecao, mes
  ` as ProjecaoHistoricoRow[];
  return rows;
}

/**
 * Busca estoque/duração real do snapshot de um mês (para exibir na coluna do mês passado).
 * Retorna Map<key, { estoque_real, duracao_real }> onde key = categoria|linha|subgrupo|grade|colecao.
 * Usado para preencher "estoque real" e "duração real" das colunas de meses já fechados.
 */
export async function fetchSnapshotRealPorMes(
  company: string,
  filial: string | null,
  year: number,
  month: number
): Promise<Map<string, { estoque_real: number | null; duracao_real: number | null }>> {
  await ensureTable();
  const sql = getNeonSql();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const snapshotRows = await sql`
    SELECT DISTINCT snapshot_date
    FROM projecao_estoque_historico
    WHERE company = ${company}
      AND (${filial ?? ''} = '' OR filial = ${filial} OR (filial IS NULL AND ${filial ?? ''} = ''))
      AND snapshot_date >= ${monthStr + '-01'}::date
      AND snapshot_date < (${monthStr + '-01'}::date + INTERVAL '1 month')
    ORDER BY snapshot_date DESC
    LIMIT 1
  ` as { snapshot_date: string }[];
  const rawDate = snapshotRows[0]?.snapshot_date;
  if (rawDate == null) return new Map();
  const snapshotDate = typeof rawDate === 'string' ? rawDate : (rawDate as Date).toISOString().slice(0, 10);
  const rows = await sql`
    SELECT categoria, linha, subgrupo, grade, colecao, estoque_real, duracao_real
    FROM projecao_estoque_historico
    WHERE company = ${company}
      AND snapshot_date = ${snapshotDate}
      AND (${filial ?? ''} = '' OR filial = ${filial} OR (filial IS NULL AND ${filial ?? ''} = ''))
      AND mes = ${month}
  ` as { categoria: string; linha: string | null; subgrupo: string | null; grade: string | null; colecao: string | null; estoque_real: number | null; duracao_real: number | null }[];
  const map = new Map<string, { estoque_real: number | null; duracao_real: number | null }>();
  for (const r of rows) {
    const key = `${r.categoria}|${r.linha ?? ''}|${r.subgrupo ?? ''}|${r.grade ?? ''}|${r.colecao ?? ''}`;
    map.set(key, { estoque_real: r.estoque_real, duracao_real: r.duracao_real });
  }
  return map;
}

/**
 * Busca histórico de uma categoria ao longo do tempo.
 */
export async function fetchHistoricoByCategoria(
  company: string,
  categoria: string,
  filial: string | null,
  limit: number = 24
): Promise<ProjecaoHistoricoRow[]> {
  await ensureTable();
  const sql = getNeonSql();
  const rows = await sql`
    SELECT
      id, snapshot_date, company, filial, categoria, linha, subgrupo, grade, colecao,
      ano, mes, vendas_projetada, vendas_real, estoque_projetado, estoque_real,
      duracao_projetada, duracao_real, created_at
    FROM projecao_estoque_historico
    WHERE company = ${company}
      AND categoria = ${categoria}
      AND (${filial ?? ''} = '' OR filial = ${filial} OR (filial IS NULL AND ${filial ?? ''} = ''))
    ORDER BY snapshot_date DESC, mes
    LIMIT ${limit}
  ` as ProjecaoHistoricoRow[];
  return rows;
}
