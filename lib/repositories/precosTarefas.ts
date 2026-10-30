/**
 * Leituras de apoio da tela Programar Preços: nomes de produto e de tabela de preço
 * para o detalhe de um lote do histórico (a NERD_PRECO_HISTORICO só guarda códigos).
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { fetchHistoricoLinhas, type PrecoCompany } from '@/lib/repositories/precos';

const CHUNK = 400;

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

async function descricoesProdutos(produtos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < produtos.length; i += CHUNK) {
    const lote = produtos.slice(i, i + CHUNK);
    const rows = await withRequest(async (request) => {
      lote.forEach((p, j) => request.input(`dp${j}`, sql.VarChar, p));
      const r = await request.query<{ produto: string; descricao: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) AS produto, LTRIM(RTRIM(ISNULL(DESC_PRODUTO, ''))) AS descricao
        FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO IN (${lote.map((_, j) => `@dp${j}`).join(', ')})
      `);
      return r.recordset;
    });
    for (const row of rows) mapa.set(limpar(row.produto), limpar(row.descricao));
  }
  return mapa;
}

async function descricoesTabelas(): Promise<Map<string, string>> {
  return withRequest(async (request) => {
    const r = await request.query<{ codigo: string; descricao: string }>(`
      SELECT LTRIM(RTRIM(CODIGO_TAB_PRECO)) AS codigo, LTRIM(RTRIM(ISNULL(TABELA, ''))) AS descricao
      FROM TABELAS_PRECO WITH (NOLOCK)
    `);
    return new Map(r.recordset.map((row) => [limpar(row.codigo).toUpperCase(), limpar(row.descricao)]));
  });
}

/** Uma linha por produto × tabela × slot, com Preço e Preço Líquido lado a lado. */
export interface LoteDetalheLinha {
  produto: string;
  descricao: string;
  tabela: string;
  tabelaDesc: string;
  slot: number;
  precoAntes: number | null;
  precoDepois: number | null;
  liquidoAntes: number | null;
  liquidoDepois: number | null;
}

/**
 * Linhas de um lote agrupadas como a tela mostra: PRECOn e PRECO_LIQUIDOn do mesmo
 * produto/tabela viram uma linha só (o espelho é gravado como linha própria no histórico).
 */
export async function fetchLoteDetalhe(lote: string, company: PrecoCompany): Promise<LoteDetalheLinha[]> {
  const linhas = (await fetchHistoricoLinhas(lote)).filter((l) => l.empresa === company);
  if (linhas.length === 0) return [];

  const [produtos, tabelas] = await Promise.all([
    descricoesProdutos([...new Set(linhas.map((l) => l.produto))]),
    descricoesTabelas(),
  ]);

  const porChave = new Map<string, LoteDetalheLinha>();
  for (const l of linhas) {
    const m = /^PRECO(_LIQUIDO)?(\d)$/.exec(l.campo);
    const tabela = (l.codTabela ?? 'CADASTRO').toUpperCase();
    const slot = m ? Number(m[2]) : 0;
    const chave = m ? `${l.produto}||${tabela}||${slot}` : `${l.produto}||${tabela}||${l.campo}`;
    let alvo = porChave.get(chave);
    if (!alvo) {
      alvo = {
        produto: l.produto,
        descricao: produtos.get(l.produto) ?? '',
        tabela,
        tabelaDesc: m ? tabelas.get(tabela) ?? tabela : l.campo,
        slot,
        precoAntes: null,
        precoDepois: null,
        liquidoAntes: null,
        liquidoDepois: null,
      };
      porChave.set(chave, alvo);
    }
    if (m && m[1]) {
      alvo.liquidoAntes = l.valorAnterior;
      alvo.liquidoDepois = l.valorNovo;
    } else {
      alvo.precoAntes = l.valorAnterior;
      alvo.precoDepois = l.valorNovo;
    }
  }

  return [...porChave.values()].sort(
    (a, b) => a.produto.localeCompare(b.produto) || a.tabela.localeCompare(b.tabela) || a.slot - b.slot
  );
}
