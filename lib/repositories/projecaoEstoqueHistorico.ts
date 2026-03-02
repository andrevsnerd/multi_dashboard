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
    throw new Error('Neon/Postgres não configurado (DATABASE_URL/POSTGRES_URL).');
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
