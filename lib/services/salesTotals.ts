import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import {
  resolveCompany,
  isEcommerceFilial,
  VAREJO_VALUE,
  type CompanyKey,
  type CompanyModule,
} from '@/lib/config/company';
import { shiftRangeByMonths, type NormalizedRange } from '@/lib/utils/date';
import {
  fetchEcommerceSummary,
} from '@/lib/repositories/ecommerce';

export interface SalesTotalsParams {
  company: CompanyKey | string | undefined;
  range: NormalizedRange;
  filial?: string | null;
  linhas?: string[] | null;
  comparisonMode?: 'month' | 'year';
}

export interface SalesTotals {
  vendas: number;
  qtde: number;
  vendasPrevious: number;
  qtdePrevious: number;
  tickets: number;
  ticketsPrevious: number;
  lastSaleDate: Date | null;
}

const EMPTY: SalesTotals = {
  vendas: 0,
  qtde: 0,
  vendasPrevious: 0,
  qtdePrevious: 0,
  tickets: 0,
  ticketsPrevious: 0,
  lastSaleDate: null,
};

function buildFilialClause(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial: string | null | undefined,
): string {
  if (!companySlug) return '';
  const company = resolveCompany(companySlug);
  if (!company) return '';

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('stFilial', sql.VarChar, specificFilial);
    return 'AND f.FILIAL = @stFilial';
  }

  // Para scarfme + VAREJO: apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter((f) => !ecommerceFilials.includes(f));
    if (normalFiliais.length === 0) return '';
    normalFiliais.forEach((f, i) => request.input(`stF${i}`, sql.VarChar, f));
    const placeholders = normalFiliais.map((_, i) => `@stF${i}`).join(', ');
    return `AND f.FILIAL IN (${placeholders})`;
  }

  // Para scarfme + null: todas (a agregação ecommerce trata sua parte)
  // Para outras empresas: apenas filiais normais
  const targetList = isScarfme && specificFilial == null
    ? filiais
    : filiais.filter((f) => !ecommerceFilials.includes(f));
  if (targetList.length === 0) return '';

  targetList.forEach((f, i) => request.input(`stF${i}`, sql.VarChar, f));
  const placeholders = targetList.map((_, i) => `@stF${i}`).join(', ');
  return `AND f.FILIAL IN (${placeholders})`;
}

function buildLinhaClause(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  linhas: string[] | null | undefined,
): { active: boolean; clause: string } {
  if (companySlug !== 'nerd') return { active: false, clause: '' };
  const list = (linhas ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return { active: false, clause: '' };

  if (list.length === 1) {
    request.input('stLinha', sql.VarChar, list[0]);
    return {
      active: true,
      clause: `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @stLinha`,
    };
  }

  list.forEach((l, i) => request.input(`stLinha${i}`, sql.VarChar, l));
  const placeholders = list.map((_, i) => `@stLinha${i}`).join(', ');
  return {
    active: true,
    clause: `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})`,
  };
}

/**
 * Fonte global e canônica dos totais de vendas (Vendas, Quantidade, Tickets).
 *
 * Usada por:
 *  - Dashboard (`/api/dashboard-data` → `fetchSalesSummary`)
 *  - Produtos por Venda (`/api/sales-summary` → `fetchSalesSummary`)
 *  - Curva ABC (`/api/curva-abc`)
 *
 * Regra única e consistente:
 *  - exclui linhas canceladas (`QTDE_CANCELADA = 0`)
 *  - subtrai trocas do mesmo ticket/produto
 *  - inclui devoluções puras como movimento negativo
 *  - aplica filtros opcionais de filial e linha (NERD)
 */
export async function fetchSalesTotals(params: SalesTotalsParams): Promise<SalesTotals> {
  const { company, range, filial, linhas, comparisonMode = 'month' } = params;

  if (!company) return { ...EMPTY };

  // Ecommerce: se a filial selecionada é puramente ecommerce, delegar para o repositório de ecommerce
  if (isEcommerceFilial(company as string, filial ?? null)) {
    const summary = await fetchEcommerceSummary({
      company: company as string,
      range,
      filial: filial ?? null,
      linhas: linhas ?? null,
    });
    const s = summary.summary;
    return {
      vendas: s.totalRevenue.currentValue,
      qtde: s.totalQuantity.currentValue,
      vendasPrevious: s.totalRevenue.previousValue,
      qtdePrevious: s.totalQuantity.previousValue,
      tickets: s.totalTickets.currentValue,
      ticketsPrevious: s.totalTickets.previousValue,
      lastSaleDate: summary.currentPeriodLastSaleDate ?? null,
    };
  }

  // Scarfme com "todas as filiais": agregar varejo + ecommerce
  const companyConfig = resolveCompany(company as string);
  const isScarfmeAll =
    company === 'scarfme' && filial == null && (companyConfig?.ecommerceFilials?.length ?? 0) > 0;

  if (isScarfmeAll) {
    const [varejo, ecom] = await Promise.all([
      fetchSalesTotals({ ...params, filial: VAREJO_VALUE }),
      fetchEcommerceSummary({
        company: company as string,
        range,
        filial: null,
        linhas: linhas ?? null,
      }),
    ]);
    const e = ecom.summary;
    const lastSaleDate = [varejo.lastSaleDate, ecom.currentPeriodLastSaleDate ?? null]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      vendas: varejo.vendas + e.totalRevenue.currentValue,
      qtde: varejo.qtde + e.totalQuantity.currentValue,
      vendasPrevious: varejo.vendasPrevious + e.totalRevenue.previousValue,
      qtdePrevious: varejo.qtdePrevious + e.totalQuantity.previousValue,
      tickets: varejo.tickets + e.totalTickets.currentValue,
      ticketsPrevious: varejo.ticketsPrevious + e.totalTickets.previousValue,
      lastSaleDate,
    };
  }

  const previousRange = shiftRangeByMonths(range, comparisonMode === 'year' ? -12 : -1);

  return withRequest(async (request) => {
    request.input('stStart', sql.DateTime, range.start);
    request.input('stEnd', sql.DateTime, range.end);
    request.input('stPrevStart', sql.DateTime, previousRange.start);
    request.input('stPrevEnd', sql.DateTime, previousRange.end);

    const filialClause = buildFilialClause(request, company as string, 'sales', filial ?? null);
    const linhaTokens = buildLinhaClause(request, company as string, linhas);
    const needsProdutoJoin = linhaTokens.active;

    const produtoJoinVp = needsProdutoJoin
      ? 'LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO'
      : '';
    const produtoJoinVt = needsProdutoJoin
      ? 'LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO'
      : '';

    const query = `
      WITH vendas_base AS (
        SELECT
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.DATA_VENDA,
          vp.PRODUTO,
          vp.COR_PRODUTO,
          vp.TAMANHO,
          vp.QTDE,
          vp.PRECO_LIQUIDO,
          CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        ${produtoJoinVp}
        WHERE (
            (vp.DATA_VENDA >= @stStart AND vp.DATA_VENDA < @stEnd)
            OR (vp.DATA_VENDA >= @stPrevStart AND vp.DATA_VENDA < @stPrevEnd)
          )
          AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${filialClause}
          ${linhaTokens.clause}
      ),
      trocas_item AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        WHERE vt.QTDE_CANCELADA = 0
          AND (
            (v.DATA_VENDA >= @stStart AND v.DATA_VENDA < @stEnd)
            OR (v.DATA_VENDA >= @stPrevStart AND v.DATA_VENDA < @stPrevEnd)
          )
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT
          v.DATA_VENDA,
          vt.TICKET,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        ${produtoJoinVt}
        WHERE vt.QTDE_CANCELADA = 0
          AND (
            (v.DATA_VENDA >= @stStart AND v.DATA_VENDA < @stEnd)
            OR (v.DATA_VENDA >= @stPrevStart AND v.DATA_VENDA < @stPrevEnd)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            WHERE vp.TICKET = vt.TICKET
              AND vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
              AND vp.PRODUTO = vt.PRODUTO
              AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
              AND ISNULL(vp.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
              AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          )
          ${filialClause}
          ${linhaTokens.clause}
      ),
      VendasComNumero AS (
        SELECT
          vb.TICKET,
          vb.CODIGO_FILIAL,
          vb.DATA_VENDA,
          vb.PRODUTO,
          vb.COR_PRODUTO,
          vb.TAMANHO,
          vb.QTDE,
          vb.PRECO_LIQUIDO,
          vb.DESCONTO_VENDA,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM vendas_base vb
      ),
      MovimentoUnificado AS (
        SELECT
          vcn.DATA_VENDA,
          vcn.TICKET,
          CAST((
            CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6))
            - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6))
            - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))
          ) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti
          ON ti.TICKET = vcn.TICKET
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
        UNION ALL
        SELECT
          tp.DATA_VENDA,
          tp.TICKET,
          tp.VALOR_LIQUIDO_CALC,
          tp.QTDE_LIQUIDA_CALC
        FROM TrocasPuras tp
      )
      SELECT
        SUM(CASE WHEN DATA_VENDA >= @stStart AND DATA_VENDA < @stEnd THEN VALOR_LIQUIDO_CALC ELSE 0 END) AS currentRevenue,
        SUM(CASE WHEN DATA_VENDA >= @stPrevStart AND DATA_VENDA < @stPrevEnd THEN VALOR_LIQUIDO_CALC ELSE 0 END) AS previousRevenue,
        SUM(CASE WHEN DATA_VENDA >= @stStart AND DATA_VENDA < @stEnd THEN QTDE_LIQUIDA_CALC ELSE 0 END) AS currentQuantity,
        SUM(CASE WHEN DATA_VENDA >= @stPrevStart AND DATA_VENDA < @stPrevEnd THEN QTDE_LIQUIDA_CALC ELSE 0 END) AS previousQuantity,
        COUNT(DISTINCT CASE
          WHEN DATA_VENDA >= @stStart AND DATA_VENDA < @stEnd AND QTDE_LIQUIDA_CALC > 0
          THEN TICKET ELSE NULL
        END) AS currentTickets,
        COUNT(DISTINCT CASE
          WHEN DATA_VENDA >= @stPrevStart AND DATA_VENDA < @stPrevEnd AND QTDE_LIQUIDA_CALC > 0
          THEN TICKET ELSE NULL
        END) AS previousTickets,
        MAX(CASE WHEN DATA_VENDA >= @stStart AND DATA_VENDA < @stEnd THEN DATA_VENDA ELSE NULL END) AS lastSaleDate
      FROM MovimentoUnificado
    `;

    const result = await request.query<{
      currentRevenue: number | null;
      previousRevenue: number | null;
      currentQuantity: number | null;
      previousQuantity: number | null;
      currentTickets: number | null;
      previousTickets: number | null;
      lastSaleDate: Date | null;
    }>(query);

    const row = result.recordset[0];
    if (!row) return { ...EMPTY };

    return {
      vendas: Number(row.currentRevenue ?? 0),
      qtde: Number(row.currentQuantity ?? 0),
      vendasPrevious: Number(row.previousRevenue ?? 0),
      qtdePrevious: Number(row.previousQuantity ?? 0),
      tickets: Number(row.currentTickets ?? 0),
      ticketsPrevious: Number(row.previousTickets ?? 0),
      lastSaleDate: row.lastSaleDate ? new Date(row.lastSaleDate) : null,
    };
  });
}
