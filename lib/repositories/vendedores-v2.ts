/**
 * Vendedores V2 - Backend otimizado para carregar rápido.
 * - Lista: uma query só em W_CTB_LOJA_VENDA_PEDIDO_PRODUTO (vp), sem join com pedido.
 * - Apelido do vendedor: segunda query rápida em LOJA_VENDEDORES (tabela pequena).
 */

import sql from 'mssql';
import {
  resolveCompany,
  type CompanyModule,
  VAREJO_VALUE,
} from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export interface VendedorItem {
  vendedor: string;
  filial: string;
  faturamento: number;
  quantidadeVendida: number;
  tickets: number;
  ticketMedio: number;
  quantidadePorTicket: number;
  participacaoFilial: number;
  grupoMaisVendido?: string;
  subgrupoMaisVendido?: string;
}

export interface VendedorProdutoItem {
  codigo?: string;
  grupo?: string;
  linha?: string;
  colecao?: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  descricao: string;
  faturamento: number;
  quantidade: number;
}

export interface VendedoresListParams {
  company?: string;
  filial?: string | null;
  range?: { start?: Date | string; end?: Date | string };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  produtoId?: string;
  produtoSearchTerm?: string;
  /** false = inclui grupo/subgrupo mais vendido (mais lento). Default true = só métricas. */
  light?: boolean;
}

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp'
): string {
  if (!companySlug) return '';
  const company = resolveCompany(companySlug);
  if (!company) return '';

  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const isScarfme = companySlug === 'scarfme';

  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('filial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @filial`;
  }

  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter((f) => !ecommerceFilials.includes(f));
    if (normalFiliais.length === 0) return '';
    normalFiliais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
    return `AND ${tableAlias}.FILIAL IN (${normalFiliais.map((_, i) => `@filial${i}`).join(', ')})`;
  }

  if (isScarfme && specificFilial === null && filiais.length > 0) {
    filiais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
    return `AND ${tableAlias}.FILIAL IN (${filiais.map((_, i) => `@filial${i}`).join(', ')})`;
  }

  if (filiais.length === 0) return '';
  filiais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
  return `AND ${tableAlias}.FILIAL IN (${filiais.map((_, i) => `@filial${i}`).join(', ')})`;
}

function buildListFilter(
  request: sql.Request | RequestLike,
  fieldExpression: string,
  values: string[] | undefined,
  paramBase: string
): string {
  if (!values?.length) return '';
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (!nonEmpty.length) return '';
  nonEmpty.forEach((v, i) => request.input(`${paramBase}${i}`, sql.VarChar, v));
  return `AND ${fieldExpression} IN (${nonEmpty.map((_, i) => `@${paramBase}${i}`).join(', ')})`;
}

/**
 * Lista de vendedores: uma passagem com CTEs.
 * light=true (default): só métricas, sem grupo/subgrupo mais vendido.
 */
export async function fetchVendedoresList(
  params: VendedoresListParams
): Promise<VendedorItem[]> {
  return withRequest(async (request) => {
    const {
      company,
      filial,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
      light = true,
    } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const needProdutoJoin =
      (grupos?.length ?? 0) > 0 ||
      (linhas?.length ?? 0) > 0 ||
      (colecoes?.length ?? 0) > 0 ||
      (subgrupos?.length ?? 0) > 0 ||
      (grades?.length ?? 0) > 0;

    const grupoFilter = buildListFilter(
      request,
      "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );
    const linhaFilter = buildListFilter(
      request,
      "COALESCE(vp.LINHA, p.LINHA, '')",
      linhas,
      'linha'
    );
    const colecaoFilter = buildListFilter(
      request,
      "COALESCE(vp.COLECAO, p.COLECAO, '')",
      colecoes,
      'colecao'
    );
    const subgrupoFilter = buildListFilter(
      request,
      "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );
    const gradeFilter = buildListFilter(
      request,
      'CONVERT(VARCHAR, p.GRADE)',
      grades,
      'grade'
    );

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = 'AND vp.PRODUTO = @produtoId';
    } else if (produtoSearchTerm?.trim().length >= 2) {
      request.input('produtoSearchTerm', sql.VarChar, `%${produtoSearchTerm.trim()}%`);
      produtoFilter = 'AND vp.DESC_PRODUTO LIKE @produtoSearchTerm';
    }

    const produtoJoin =
      needProdutoJoin
        ? `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`
        : '';

    // Uma única passagem, SEM JOIN com pedido: só vp (itens). Muito mais rápido.
    const mainQuery = `
      WITH Base AS (
        SELECT
          vp.FILIAL,
          vp.VENDEDOR,
          valor = CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END,
          qtde_eff = CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END,
          ticket = CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.QTDE > 0 THEN vp.TICKET ELSE NULL END
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        ${produtoJoin}
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${needProdutoJoin ? grupoFilter : ''}
          ${needProdutoJoin ? linhaFilter : ''}
          ${needProdutoJoin ? colecaoFilter : ''}
          ${needProdutoJoin ? subgrupoFilter : ''}
          ${needProdutoJoin ? gradeFilter : ''}
          ${produtoFilter}
      ),
      Agg AS (
        SELECT
          FILIAL,
          VENDEDOR,
          SUM(valor) AS faturamento,
          SUM(qtde_eff) AS quantidadeVendida,
          COUNT(DISTINCT ticket) AS tickets
        FROM Base
        GROUP BY FILIAL, VENDEDOR
        HAVING SUM(valor) > 0
      )
      SELECT
        VENDEDOR AS vendedor,
        FILIAL AS filial,
        faturamento,
        quantidadeVendida,
        tickets,
        SUM(faturamento) OVER (PARTITION BY FILIAL) AS totalFilial
      FROM Agg
      ORDER BY faturamento DESC
    `;

    const mainResult = await request.query<{
      vendedor: string;
      filial: string;
      faturamento: number;
      quantidadeVendida: number;
      tickets: number;
      totalFilial: number;
    }>(mainQuery);

    const codigos = [...new Set((mainResult.recordset ?? []).map((r) => (r.vendedor ?? '').trim()).filter(Boolean))];
    const apelidoByCodigo = new Map<string, string>();

    if (codigos.length > 0) {
      codigos.forEach((cod, i) => request.input(`v${i}`, sql.VarChar, cod));
      const inList = codigos.map((_, i) => `@v${i}`).join(', ');
      const apelidoQuery = `
        SELECT
          LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo,
          LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, VENDEDOR)))) AS apelido
        FROM LOJA_VENDEDORES WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) IN (${inList})
      `;
      const apelidoResult = await request.query<{ codigo: string; apelido: string }>(apelidoQuery);
      (apelidoResult.recordset ?? []).forEach((r) => apelidoByCodigo.set((r.codigo ?? '').trim(), (r.apelido ?? r.codigo ?? '').trim()));
    }

    const items: VendedorItem[] = mainResult.recordset.map((row) => {
      const codigo = (row.vendedor ?? '').trim();
      const faturamento = row.faturamento ?? 0;
      const tickets = row.tickets ?? 0;
      const quantidadeVendida = row.quantidadeVendida ?? 0;
      const totalFilial = row.totalFilial ?? 0;
      const ticketMedio = tickets > 0 ? faturamento / tickets : 0;
      const quantidadePorTicket = tickets > 0 ? quantidadeVendida / tickets : 0;
      const participacaoFilial = totalFilial > 0 ? (faturamento / totalFilial) * 100 : 0;
      const nomeExibir = apelidoByCodigo.get(codigo) || codigo || 'SEM VENDEDOR';

      return {
        vendedor: nomeExibir,
        filial: row.filial,
        faturamento,
        quantidadeVendida,
        tickets,
        ticketMedio,
        quantidadePorTicket,
        participacaoFilial,
      };
    });

    return items;
  });
}

export interface VendedorProdutosListParams {
  company?: string;
  vendedor: string;
  filial: string;
  range?: { start?: Date | string; end?: Date | string };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  produtoId?: string;
  produtoSearchTerm?: string;
}

/**
 * Produtos do vendedor: query enxuta, só campos usados na tela.
 */
export async function fetchVendedorProdutosList(
  params: VendedorProdutosListParams
): Promise<VendedorProdutoItem[]> {
  return withRequest(async (request) => {
    const {
      company,
      vendedor,
      filial,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
    } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('vendedor', sql.VarChar, vendedor);
    request.input('filial', sql.VarChar, filial);

    const grupoFilter = buildListFilter(
      request,
      "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );
    const linhaFilter = buildListFilter(
      request,
      "COALESCE(vp.LINHA, p.LINHA, '')",
      linhas,
      'linha'
    );
    const colecaoFilter = buildListFilter(
      request,
      "COALESCE(vp.COLECAO, p.COLECAO, '')",
      colecoes,
      'colecao'
    );
    const subgrupoFilter = buildListFilter(
      request,
      "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );
    const gradeFilter = buildListFilter(
      request,
      'CONVERT(VARCHAR, p.GRADE)',
      grades,
      'grade'
    );

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = 'AND vp.PRODUTO = @produtoId';
    } else if (produtoSearchTerm?.trim().length >= 2) {
      request.input('produtoSearchTerm', sql.VarChar, `%${produtoSearchTerm.trim()}%`);
      produtoFilter = 'AND vp.DESC_PRODUTO LIKE @produtoSearchTerm';
    }

    const query = `
      SELECT
        MAX(vp.PRODUTO) AS codigo,
        MAX(ISNULL(vp.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(vp.LINHA, p.LINHA, '')) AS linha,
        MAX(COALESCE(vp.COLECAO, p.COLECAO, '')) AS colecao,
        MAX(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(ISNULL(CONVERT(VARCHAR, p.GRADE), '')) AS grade,
        MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS cor,
        MAX(vp.DESC_PRODUTO) AS descricao,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) AS faturamento,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS quantidade
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL AND v.PEDIDO = vp.PEDIDO AND v.TICKET = vp.TICKET
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND vp.FILIAL = @filial
        AND (ISNULL(v.VENDEDOR_APELIDO, vp.VENDEDOR) = @vendedor OR vp.VENDEDOR = @vendedor)
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
      GROUP BY vp.PRODUTO, vp.DESC_PRODUTO
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) > 0
      ORDER BY faturamento DESC
    `;

    const result = await request.query<{
      codigo: string;
      grupo: string;
      linha: string;
      colecao: string;
      subgrupo: string;
      grade: string;
      cor: string;
      descricao: string;
      faturamento: number;
      quantidade: number;
    }>(query);

    return result.recordset.map((row) => ({
      codigo: row.codigo || undefined,
      grupo: row.grupo?.trim() || undefined,
      linha: row.linha?.trim() || undefined,
      colecao: row.colecao?.trim() || undefined,
      subgrupo: row.subgrupo?.trim() || undefined,
      grade: row.grade?.trim() || undefined,
      cor: row.cor?.trim() || undefined,
      descricao: row.descricao || 'SEM DESCRIÇÃO',
      faturamento: row.faturamento ?? 0,
      quantidade: row.quantidade ?? 0,
    }));
  });
}
