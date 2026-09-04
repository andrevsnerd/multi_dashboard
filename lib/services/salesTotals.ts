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
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { shiftRangeByMonths, type NormalizedRange } from '@/lib/utils/date';
import {
  fetchEcommerceSummary,
} from '@/lib/repositories/ecommerce';

export interface SalesTotalsParams {
  company: CompanyKey | string | undefined;
  range: NormalizedRange;
  filial?: string | null;
  /**
   * Escopo de LINHA da NERD (legado): por decisão antiga só se aplica quando company === 'nerd',
   * porque nasceu do toggle "Eletrônicos". Para filtrar por linha em QUALQUER empresa use
   * `linhasCadastro` — a Scarf Me trata LINHA como categoria e precisa dela.
   */
  linhas?: string[] | null;
  comparisonMode?: 'month' | 'year';
  // Filtros opcionais adicionais (usados pelo Gerador de Relatórios). Todos
  // opcionais e aditivos: callers existentes (dashboard, curva-abc) não os passam.
  grupos?: string[] | null;
  /** Filtro de LINHA que vale para qualquer empresa (ver a nota em `linhas`). */
  linhasCadastro?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  colecoes?: string[] | null;
  /** Cores por DESCRIÇÃO (ex.: "PRETO"), casadas em CORES_BASICAS.DESC_COR. */
  cores?: string[] | null;
  tipos?: string[] | null;
  produtoId?: string | null;
  /** Lista de produtos (IN) — filtra os totais por vários itens selecionados. */
  produtoIds?: string[] | null;
  produtoSearchTerm?: string | null;
}

/**
 * Cláusula `AND UPPER(col) IN (...)` para uma lista de valores. Registra os
 * inputs com o prefixo dado e devolve '' quando a lista é vazia.
 */
function buildInListClause(
  request: sql.Request | RequestLike,
  values: string[] | null | undefined,
  prefix: string,
  columnExpr: string,
): string {
  const list = (values ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return '';
  list.forEach((v, i) => request.input(`${prefix}${i}`, sql.VarChar, v));
  const placeholders = list.map((_, i) => `@${prefix}${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${columnExpr}, '')))) IN (${placeholders})`;
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

async function buildFilialClause(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial: string | null | undefined,
): Promise<string> {
  if (!companySlug) return '';
  const company = await resolveCompanyLive(companySlug);
  if (!company) return '';

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  specificFilial = await liveNameForIncoming(specificFilial);

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
  const {
    company,
    range,
    filial,
    linhas,
    comparisonMode = 'month',
    grupos,
    linhasCadastro,
    subgrupos,
    grades,
    colecoes,
    cores,
    tipos,
    produtoId,
    produtoIds,
    produtoSearchTerm,
  } = params;

  if (!company) return { ...EMPTY };

  // O e-commerce (`fetchEcommerceSummary`) filtra LINHA sem recorte por empresa, então lá as
  // duas listas viram uma só: o escopo legado da NERD e o filtro de linha do cadastro.
  const linhasEcommerce = (() => {
    const juntas = [...(linhas ?? []), ...(linhasCadastro ?? [])]
      .map((l) => (l ?? '').trim())
      .filter(Boolean);
    return juntas.length > 0 ? Array.from(new Set(juntas)) : null;
  })();

  // `fetchSalesTotals` recebe um range JÁ NORMALIZADO (end EXCLUSIVO — início do dia
  // seguinte ao último dia). `fetchEcommerceSummary`, porém, espera um range CRU
  // (end = último dia INCLUSIVO) e ele mesmo normaliza via toUtcExclusiveEnd. Se
  // repassarmos o end exclusivo, ele normaliza de novo e a janela ganha +1 dia
  // (bug: o KPI e-commerce do Loja Raio X incluía o dia seguinte na comparação e
  // divergia do dashboard). Recuamos 1 dia aqui para a normalização dele acertar o alvo.
  const ecommerceRange = {
    start: range.start,
    end: new Date(range.end.getTime() - 24 * 60 * 60 * 1000),
  };

  // Ecommerce: se a filial selecionada é puramente ecommerce, delegar para o repositório de ecommerce
  if (isEcommerceFilial(company as string, filial ?? null)) {
    const summary = await fetchEcommerceSummary({
      company: company as string,
      range: ecommerceRange,
      filial: filial ?? null,
      linhas: linhasEcommerce,
      grupos: grupos ?? null,
      subgrupos: subgrupos ?? null,
      grades: grades ?? null,
      colecoes: colecoes ?? null,
      produtoIds: produtoIds ?? null,
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
        range: ecommerceRange,
        filial: null,
        linhas: linhasEcommerce,
        grupos: grupos ?? null,
        subgrupos: subgrupos ?? null,
        grades: grades ?? null,
        colecoes: colecoes ?? null,
        produtoIds: produtoIds ?? null,
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

    const filialClause = await buildFilialClause(request, company as string, 'sales', filial ?? null);
    const linhaTokens = buildLinhaClause(request, company as string, linhas);

    // Filtros adicionais do Gerador de Relatórios (todos opcionais; '' quando vazios).
    const grupoClause = buildInListClause(request, grupos, 'stGrupo', 'p.GRUPO_PRODUTO');
    const linhaCadastroClause = buildInListClause(request, linhasCadastro, 'stLinhaCad', 'p.LINHA');
    const subgrupoClause = buildInListClause(request, subgrupos, 'stSubgrupo', 'p.SUBGRUPO_PRODUTO');
    const gradeClause = buildInListClause(request, grades, 'stGrade', 'CONVERT(VARCHAR, p.GRADE)');
    const colecaoClause = buildInListClause(request, colecoes, 'stColecao', 'p.COLECAO');
    const tipoClause = buildInListClause(request, tipos, 'stTipo', 'p.TIPO_PRODUTO');
    const corClause = buildInListClause(request, cores, 'stCor', 'c.DESC_COR');

    const needsProdutoJoin =
      linhaTokens.active ||
      !!grupoClause || !!linhaCadastroClause || !!subgrupoClause || !!gradeClause ||
      !!colecaoClause || !!tipoClause;
    const needsCoresJoin = !!corClause;

    // Filtro por lista de produtos (IN), produto específico (id) ou busca textual.
    // A lista tem prioridade (seleção de vários itens na Produto Giro). Aplica em vendas_base e trocas.
    const produtoIdsList = (produtoIds ?? []).map((p) => (p ?? '').trim()).filter(Boolean);
    let produtoClauseVp = '';
    let produtoClauseVt = '';
    if (produtoIdsList.length > 0) {
      produtoIdsList.forEach((p, i) => request.input(`stProdutoIds${i}`, sql.VarChar, p));
      const placeholders = produtoIdsList.map((_, i) => `@stProdutoIds${i}`).join(', ');
      produtoClauseVp = `AND vp.PRODUTO IN (${placeholders})`;
      produtoClauseVt = `AND vt.PRODUTO IN (${placeholders})`;
    } else if (produtoId) {
      request.input('stProdutoId', sql.VarChar, produtoId);
      produtoClauseVp = 'AND vp.PRODUTO = @stProdutoId';
      produtoClauseVt = 'AND vt.PRODUTO = @stProdutoId';
    } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
      request.input('stProdutoSearch', sql.VarChar, `%${produtoSearchTerm.trim()}%`);
      produtoClauseVp = 'AND vp.DESC_PRODUTO LIKE @stProdutoSearch';
    }

    const produtoJoinVp = needsProdutoJoin
      ? 'LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO'
      : '';
    const produtoJoinVt = needsProdutoJoin
      ? 'LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO'
      : '';
    // Descrição de cor é escopada POR PRODUTO no Linx: o mesmo código descreve
    // cores diferentes por produto. Por isso o filtro casa em PRODUTO_CORES
    // (DESC_COR_PRODUTO do cadastro do produto), não no mapa global CORES_BASICAS.
    // Mantém o alias `c` e a coluna `c.DESC_COR` para o filtro downstream não mudar.
    const coresJoinVp = needsCoresJoin
      ? `LEFT JOIN (SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR FROM PRODUTO_CORES WITH (NOLOCK) GROUP BY PRODUTO, COR_PRODUTO) c
          ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(vp.PRODUTO)) AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(vp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, vp.COR_PRODUTO))`
      : '';
    const coresJoinVt = needsCoresJoin
      ? `LEFT JOIN (SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR FROM PRODUTO_CORES WITH (NOLOCK) GROUP BY PRODUTO, COR_PRODUTO) c
          ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(vt.PRODUTO)) AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(vt.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, vt.COR_PRODUTO))`
      : '';

    // Cláusulas de atributo (produto/cor) — idênticas em vendas_base e TrocasPuras.
    const prodAttrClause = `${grupoClause}
          ${linhaCadastroClause}
          ${subgrupoClause}
          ${gradeClause}
          ${colecaoClause}
          ${tipoClause}
          ${corClause}`;

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
        ${coresJoinVp}
        WHERE (
            (vp.DATA_VENDA >= @stStart AND vp.DATA_VENDA < @stEnd)
            OR (vp.DATA_VENDA >= @stPrevStart AND vp.DATA_VENDA < @stPrevEnd)
          )
          AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${filialClause}
          ${linhaTokens.clause}
          ${prodAttrClause}
          ${produtoClauseVp}
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
        ${coresJoinVt}
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
          ${prodAttrClause}
          ${produtoClauseVt}
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
