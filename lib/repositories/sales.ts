import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import {
  fetchEcommerceSummary,
  fetchTopProductsEcommerce,
  fetchTopCategoriesEcommerce,
  fetchDailyEcommerceRevenue,
  fetchEcommerceFilialPerformance,
} from '@/lib/repositories/ecommerce';
import { fetchEstoqueKPIs } from '@/lib/repositories/controleEstoque';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { fetchMultipleProductsStock } from '@/lib/repositories/inventory';
import type {
  CategoryRevenue,
  ProductRevenue,
  SalesSummary,
  DateRangeInput,
  MetricSummary,
  FilialPerformance,
} from '@/types/dashboard';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';

const DEFAULT_LIMIT = 5;

function resolveRange(range?: DateRangeInput) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

/**
 * Verifica se deve agregar dados de ecommerce para scarfme
 */
function shouldAggregateEcommerce(
  company: string | undefined,
  filial: string | null | undefined
): boolean {
  if (!company || filial !== null) {
    return false;
  }
  
  const companyConfig = resolveCompany(company);
  const isScarfme = company === 'scarfme';
  const hasEcommerce = (companyConfig?.ecommerceFilials?.length ?? 0) > 0;
  
  return isScarfme && hasEcommerce;
}

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('filial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @filial`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`filial${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@filial${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para scarfme: se for "Todas as filiais" (null), incluir também ecommerce
  // Para outras empresas: usar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === null) {
    // Incluir todas as filiais (normais + ecommerce)
    const allFiliais = filiais; // Já inclui todas as filiais da lista
    
    if (allFiliais.length === 0) {
      return '';
    }

    allFiliais.forEach((filial, index) => {
      request.input(`filial${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@filial${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`filial${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@filial${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

export interface TopQueryParams {
  limit?: number;
  company?: string;
  range?: DateRangeInput;
  filial?: string | null;
}

export interface SummaryQueryParams {
  company?: string;
  range?: DateRangeInput;
  filial?: string | null;
  grupo?: string | null;
  grupos?: string[] | null;
  linha?: string | null;
  linhas?: string[] | null;
  colecao?: string | null;
  colecoes?: string[] | null;
  subgrupo?: string | null;
  subgrupos?: string[] | null;
  grade?: string | null;
  grades?: string[] | null;
  produtoId?: string;
  produtoSearchTerm?: string;
  acimaDoTicket?: boolean; // Se true, filtra apenas vendas acima do preço sugerido
  filterByRegistrationDate?: boolean; // Se true, filtra produtos pela data de cadastramento ao invés da data de venda
}

export interface SalesSummaryResult {
  summary: SalesSummary;
  currentPeriodLastSaleDate: Date | null;
  availableRange: {
    start: Date | null;
    end: Date | null;
  };
}

export async function fetchTopProducts({
  limit = DEFAULT_LIMIT,
  company,
  range,
  filial,
}: TopQueryParams = {}): Promise<ProductRevenue[]> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchTopProductsEcommerce({ limit, company, range, filial });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    // Buscar produtos de vendas normais e ecommerce em paralelo
    const [salesProducts, ecommerceProducts] = await Promise.all([
      fetchTopProducts({ limit: limit * 2, company, range, filial: VAREJO_VALUE }),
      fetchTopProductsEcommerce({ limit: limit * 2, company, range, filial: null }),
    ]);

    // Agregar produtos por productId
    const productMap = new Map<string, ProductRevenue>();

    // Adicionar produtos de vendas normais
    salesProducts.forEach((product) => {
      productMap.set(product.productId, { ...product });
    });

    // Agregar produtos de ecommerce
    ecommerceProducts.forEach((product) => {
      const existing = productMap.get(product.productId);
      if (existing) {
        existing.totalRevenue += product.totalRevenue;
        existing.totalQuantity += product.totalQuantity;
        // Manter o estoque da venda normal (já foi buscado)
      } else {
        productMap.set(product.productId, { ...product });
      }
    });

    // Converter para array, ordenar por revenue e pegar os top N
    const aggregated = Array.from(productMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    return aggregated;
  }

  // Função normal para vendas de loja
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Ajustar filtro de filial para usar f.FILIAL (da tabela FILIAIS) quando usar LOJA_VENDA_PRODUTO
    const filialFilterBase = buildFilialFilter(request, company, 'sales', filial, 'f');
    const filialFilter = filialFilterBase.replace(/f\.FILIAL/g, 'f.FILIAL').replace(/AND f\.FILIAL/g, 'AND f.FILIAL');

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
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_ITEM,
          vp.CUSTO,
          vp.FATOR_VENDA_LIQ,
          f.FILIAL,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRIFFE,
          p.GRADE,
          CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE CAST((vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6))
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vp.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
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
          AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          v.DATA_VENDA,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          0 AS QTDE,
          0 AS QTDE_CANCELADA,
          vt.PRECO_LIQUIDO,
          vt.DESCONTO_ITEM,
          vt.CUSTO,
          NULL AS FATOR_VENDA_LIQ,
          f.FILIAL,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRIFFE,
          p.GRADE,
          0 AS DESCONTO_VENDA,
          0 AS TOTAL_VENDA,
          0 AS TOTAL_QTDE_VENDA,
          vt.QTDE AS QTDE_TROCA_ITEM,
          (vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA_ITEM,
          (0 - vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vt.PRODUTO
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @startDate
          AND v.DATA_VENDA < @endDate
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
          ${filialFilter}
      ),
      VendasComNumero AS (
        SELECT 
          vb.*,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM vendas_base vb
      ),
      vendas_com_troca AS (
        SELECT 
          vcn.TICKET,
          vcn.CODIGO_FILIAL,
          vcn.DATA_VENDA,
          vcn.PRODUTO,
          vcn.COR_PRODUTO,
          vcn.TAMANHO,
          vcn.QTDE,
          vcn.QTDE_CANCELADA,
          vcn.PRECO_LIQUIDO,
          vcn.DESCONTO_ITEM,
          vcn.CUSTO,
          vcn.FATOR_VENDA_LIQ,
          vcn.FILIAL,
          vcn.DESC_PRODUTO,
          vcn.GRUPO_PRODUTO,
          vcn.SUBGRUPO_PRODUTO,
          vcn.LINHA,
          vcn.COLECAO,
          vcn.GRIFFE,
          vcn.GRADE,
          vcn.DESCONTO_VENDA,
          vcn.TOTAL_VENDA,
          vcn.TOTAL_QTDE_VENDA,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA_ITEM,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS VALOR_TROCA_ITEM,
          ((vcn.PRECO_LIQUIDO * vcn.QTDE) - vcn.DESCONTO_VENDA - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT * FROM vendas_com_troca
        UNION ALL
        SELECT * FROM TrocasPuras
      )
      SELECT TOP (@limit)
        PRODUTO AS productId,
        MAX(DESC_PRODUTO) AS productName,
        SUM(VALOR_LIQUIDO_CALC) AS totalRevenue,
        SUM(QTDE_LIQUIDA_CALC) AS totalQuantity
      FROM vendas_finais
      GROUP BY PRODUTO
      ORDER BY totalRevenue DESC;
    `;

    const result = await request.query<ProductRevenue>(query);

    const rowToProductId = (row: Record<string, unknown>) =>
      String((row as { productId?: string; productid?: string; PRODUTO?: string }).productId ?? (row as { productId?: string; productid?: string; PRODUTO?: string }).productid ?? (row as { productId?: string; productid?: string; PRODUTO?: string }).PRODUTO ?? '').trim();

    const products = result.recordset.map((row) => {
      const productId = rowToProductId(row as Record<string, unknown>);
      return {
        productId,
        productName: String((row as { productName?: string; productname?: string; DESC_PRODUTO?: string }).productName ?? (row as { productName?: string; productname?: string; DESC_PRODUTO?: string }).productname ?? (row as { productName?: string; productname?: string; DESC_PRODUTO?: string }).DESC_PRODUTO ?? ''),
        totalRevenue: Number((row as { totalRevenue?: number; totalrevenue?: number }).totalRevenue ?? (row as { totalRevenue?: number; totalrevenue?: number }).totalrevenue ?? 0),
        totalQuantity: Number((row as { totalQuantity?: number; totalquantity?: number }).totalQuantity ?? (row as { totalQuantity?: number; totalquantity?: number }).totalquantity ?? 0),
        stock: 0, // Será preenchido abaixo
      };
    });

    // Buscar estoque total (todas as filiais) para cada produto
    if (products.length > 0) {
      const productIds = products.map((p) => p.productId).filter(Boolean);
      const stockMap = await fetchMultipleProductsStock(productIds, {
        company,
        filial: null, // sempre estoque total (todas as filiais)
      });

      products.forEach((product) => {
        product.stock = stockMap.get(product.productId) ?? 0;
      });
    }

    return products;
  });
}

export async function fetchSalesSummary({
  company,
  range,
  filial,
  grupo,
  grupos,
  linha,
  linhas,
  colecao,
  colecoes,
  subgrupo,
  subgrupos,
  grade,
  grades,
  produtoId,
  produtoSearchTerm,
  acimaDoTicket = false,
  filterByRegistrationDate = false,
}: SummaryQueryParams = {}): Promise<SalesSummaryResult> {
  // Resolver o range uma vez para usar em toda a função
  const currentRange = resolveRange(range);
  
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchEcommerceSummary({ company, range, filial, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, produtoId, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    // Buscar vendas normais (varejo), ecommerce e estoque em paralelo
    const [salesResult, ecommerceResult, stockKpisForAll] = await Promise.all([
      fetchSalesSummary({ company, range, filial: VAREJO_VALUE, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, produtoId, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate }),
      fetchEcommerceSummary({ company, range, filial: null, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, produtoId, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate }),
      fetchEstoqueKPIs({
        company,
        filial: null, // Todas as filiais (varejo + ecommerce)
        grupos,
        linhas,
        colecoes,
        subgrupos,
        grades,
        produtoId,
        produtoSearchTerm,
        filterByRegistrationDate,
        range: currentRange,
      }),
    ]);

    // Agregar os resultados
    const aggregateMetric = (
      sales: MetricSummary,
      ecommerce: MetricSummary
    ): MetricSummary => {
      const current = sales.currentValue + ecommerce.currentValue;
      const previous = sales.previousValue + ecommerce.previousValue;

      if (previous === 0 && current === 0) {
        return {
          currentValue: current,
          previousValue: previous,
          changePercentage: 0,
        };
      }

      const changePercentage =
        previous === 0
          ? null
          : Number((((current - previous) / previous) * 100).toFixed(1));

      return {
        currentValue: current,
        previousValue: previous,
        changePercentage,
      };
    };

    const summary: SalesSummary = {
      totalRevenue: aggregateMetric(
        salesResult.summary.totalRevenue,
        ecommerceResult.summary.totalRevenue
      ),
      totalQuantity: aggregateMetric(
        salesResult.summary.totalQuantity,
        ecommerceResult.summary.totalQuantity
      ),
      totalTickets: aggregateMetric(
        salesResult.summary.totalTickets,
        ecommerceResult.summary.totalTickets
      ),
      averageTicket: {
        currentValue:
          (salesResult.summary.totalTickets.currentValue +
            ecommerceResult.summary.totalTickets.currentValue) > 0
            ? Number(
                (
                  (salesResult.summary.totalRevenue.currentValue +
                    ecommerceResult.summary.totalRevenue.currentValue) /
                  (salesResult.summary.totalTickets.currentValue +
                    ecommerceResult.summary.totalTickets.currentValue)
                ).toFixed(2)
              )
            : 0,
        previousValue:
          (salesResult.summary.totalTickets.previousValue +
            ecommerceResult.summary.totalTickets.previousValue) > 0
            ? Number(
                (
                  (salesResult.summary.totalRevenue.previousValue +
                    ecommerceResult.summary.totalRevenue.previousValue) /
                  (salesResult.summary.totalTickets.previousValue +
                    ecommerceResult.summary.totalTickets.previousValue)
                ).toFixed(2)
              )
            : 0,
        changePercentage: null, // Será calculado abaixo
      },
      totalStockQuantity: {
        currentValue: stockKpisForAll.estoqueTotal,
        previousValue: stockKpisForAll.estoqueTotal, // Estoque não tem histórico temporal
        changePercentage: null,
      },
      totalStockValue: {
        currentValue: stockKpisForAll.valorEmEstoque,
        previousValue: stockKpisForAll.valorEmEstoque, // Estoque não tem histórico temporal
        changePercentage: null,
      },
    };

    // Calcular changePercentage do averageTicket
    if (summary.averageTicket.previousValue > 0) {
      summary.averageTicket.changePercentage = Number(
        (
          ((summary.averageTicket.currentValue -
            summary.averageTicket.previousValue) /
            summary.averageTicket.previousValue) *
          100
        ).toFixed(1)
      );
    } else if (summary.averageTicket.currentValue > 0) {
      summary.averageTicket.changePercentage = null;
    } else {
      summary.averageTicket.changePercentage = 0;
    }

    // Usar a última data de venda mais recente
    const lastSaleDate =
      salesResult.currentPeriodLastSaleDate &&
      ecommerceResult.currentPeriodLastSaleDate
        ? new Date(
            Math.max(
              salesResult.currentPeriodLastSaleDate.getTime(),
              ecommerceResult.currentPeriodLastSaleDate.getTime()
            )
          )
        : salesResult.currentPeriodLastSaleDate ||
          ecommerceResult.currentPeriodLastSaleDate;

    // Usar o range disponível mais amplo
    const availableRange = {
      start:
        salesResult.availableRange.start && ecommerceResult.availableRange.start
          ? new Date(
              Math.min(
                salesResult.availableRange.start.getTime(),
                ecommerceResult.availableRange.start.getTime()
              )
            )
          : salesResult.availableRange.start ||
            ecommerceResult.availableRange.start,
      end:
        salesResult.availableRange.end && ecommerceResult.availableRange.end
          ? new Date(
              Math.max(
                salesResult.availableRange.end.getTime(),
                ecommerceResult.availableRange.end.getTime()
              )
            )
          : salesResult.availableRange.end || ecommerceResult.availableRange.end,
    };

    return {
      summary,
      currentPeriodLastSaleDate: lastSaleDate,
      availableRange,
    };
  }

  // Função normal para vendas de loja
  return withRequest(async (request) => {
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);
    // Período anterior = mesmos dias do período atual (ex.: 1 a 5 → 1 a 5 do mês anterior). End é exclusivo.

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, previousRange.end);

    // Ajustar filtro de filial para usar f.FILIAL (da tabela FILIAIS) quando usar LOJA_VENDA_PRODUTO
    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'f');
    
    // Criar filtro de grupo para NERD (suporta múltiplos)
    let grupoFilter = '';
    let grupoJoin = '';
    // Se acimaDoTicket ou filterByRegistrationDate estiver ativo, precisamos do JOIN com PRODUTOS
    if ((acimaDoTicket || filterByRegistrationDate) && company !== 'scarfme') {
      grupoJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`;
    }
    const gruposList = grupos && grupos.length > 0 ? grupos : grupo ? [grupo] : [];
    if (company === 'nerd' && gruposList.length > 0) {
      const gruposNormalizados = gruposList.map(g => g.trim().toUpperCase());
      if (!grupoJoin) {
        grupoJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`;
      }
      
      if (gruposNormalizados.length === 1) {
        request.input('grupo', sql.VarChar, gruposNormalizados[0]);
        grupoFilter = `AND (
          UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) = @grupo
          OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupo
        )`;
      } else {
        gruposNormalizados.forEach((g, index) => {
          request.input(`grupo${index}`, sql.VarChar, g);
        });
        const placeholders = gruposNormalizados.map((_, index) => `@grupo${index}`).join(', ');
        grupoFilter = `AND (
          UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) IN (${placeholders})
          OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) IN (${placeholders})
        )`;
      }
    }

    // Criar filtros para ScarfMe (suporta múltiplos)
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    let scarfmeJoin = '';
    
    if (company === 'scarfme') {
      const linhasList = linhas && linhas.length > 0 ? linhas : linha ? [linha] : [];
      if (linhasList.length > 0) {
        const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
        if (linhasNormalizadas.length === 1) {
          request.input('linha', sql.VarChar, linhasNormalizadas[0]);
          linhaFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) = @linha
            OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linha
          )`;
        } else {
          linhasNormalizadas.forEach((l, index) => {
            request.input(`linha${index}`, sql.VarChar, l);
          });
          const placeholders = linhasNormalizadas.map((_, index) => `@linha${index}`).join(', ');
          linhaFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) IN (${placeholders})
            OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})
          )`;
        }
      }
      
      const colecoesList = colecoes && colecoes.length > 0 ? colecoes : colecao ? [colecao] : [];
      if (colecoesList.length > 0) {
        const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
        if (colecoesNormalizadas.length === 1) {
          request.input('colecao', sql.VarChar, colecoesNormalizadas[0]);
          colecaoFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) = @colecao
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao
          )`;
        } else {
          colecoesNormalizadas.forEach((c, index) => {
            request.input(`colecao${index}`, sql.VarChar, c);
          });
          const placeholders = colecoesNormalizadas.map((_, index) => `@colecao${index}`).join(', ');
          colecaoFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) IN (${placeholders})
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
          )`;
        }
      }
      
      const subgruposList = subgrupos && subgrupos.length > 0 ? subgrupos : subgrupo ? [subgrupo] : [];
      if (subgruposList.length > 0) {
        const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
        if (subgruposNormalizados.length === 1) {
          request.input('subgrupo', sql.VarChar, subgruposNormalizados[0]);
          subgrupoFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) = @subgrupo
            OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo
          )`;
        } else {
          subgruposNormalizados.forEach((s, index) => {
            request.input(`subgrupo${index}`, sql.VarChar, s);
          });
          const placeholders = subgruposNormalizados.map((_, index) => `@subgrupo${index}`).join(', ');
          subgrupoFilter = `AND (
            UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
            OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
          )`;
        }
      }
      
      const gradesList = grades && grades.length > 0 ? grades : grade ? [grade] : [];
      if (gradesList.length > 0) {
        const gradesNormalizadas = gradesList.map(g => g.trim().toUpperCase());
        if (gradesNormalizadas.length === 1) {
          request.input('grade', sql.VarChar, gradesNormalizadas[0]);
          gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @grade`;
        } else {
          gradesNormalizadas.forEach((g, index) => {
            request.input(`grade${index}`, sql.VarChar, g);
          });
          const placeholders = gradesNormalizadas.map((_, index) => `@grade${index}`).join(', ');
          gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) IN (${placeholders})`;
        }
      }
      // JOIN com PRODUTOS só quando há filtro de linha/coleção/subgrupo/grade (dashboard sem filtros = mais rápido)
      const scarfmeNeedsProduto = linhasList.length > 0 || colecoesList.length > 0 || subgruposList.length > 0 || gradesList.length > 0;
      if (scarfmeNeedsProduto && !grupoJoin) {
        scarfmeJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`;
      }
      if ((acimaDoTicket || filterByRegistrationDate) && !grupoJoin && !scarfmeJoin) {
        grupoJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`;
      }
    }

    // Filtro de produto
    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = `AND vp.PRODUTO = @produtoId`;
    } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
      const searchPattern = `%${produtoSearchTerm.trim()}%`;
      request.input('produtoSearchTerm', sql.VarChar, searchPattern);
      produtoFilter = `AND vp.DESC_PRODUTO LIKE @produtoSearchTerm`;
    }

    const needProdutoJoin = !!(grupoJoin || scarfmeJoin);
    const hasProdutoFilter = !!(produtoId || (produtoSearchTerm && produtoSearchTerm.trim().length >= 2));
    const useLightQuery = !needProdutoJoin && !acimaDoTicket && !filterByRegistrationDate && !hasProdutoFilter;

    // Se acimaDoTicket estiver ativo, filtrar apenas vendas onde PRECO_LIQUIDO > preço sugerido
    let acimaDoTicketFilter = '';
    if (acimaDoTicket) {
      acimaDoTicketFilter = `AND p.PRECO_REPOSICAO_1 IS NOT NULL 
         AND p.PRECO_REPOSICAO_1 > 0 
         AND vp.PRECO_LIQUIDO > CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2))`;
      
      // Para NERD, remover linha ASSISTENCIA nesta visão
      if (company === 'nerd') {
        acimaDoTicketFilter += `
         AND UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) <> 'ASSISTENCIA'
         AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) <> 'ASSISTENCIA'`;
      }
    }

    // Se filterByRegistrationDate estiver ativo, filtrar produtos pela data de cadastramento no período
    let registrationDateFilter = '';
    if (filterByRegistrationDate) {
      // Garantir que temos o JOIN com PRODUTOS
      if (!grupoJoin && !scarfmeJoin) {
        grupoJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO`;
      }
      registrationDateFilter = `AND p.DATA_CADASTRAMENTO >= @startDate
        AND p.DATA_CADASTRAMENTO < @endDate
        AND p.DATA_CADASTRAMENTO IS NOT NULL`;
    }

    // Query com cálculo de valores líquidos considerando trocas.
    // useLightQuery = true (dashboard sem filtros): sem JOIN PRODUTOS = muito mais rápido.
    const lightQuery = `
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
        WHERE (
            (vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate)
            OR (vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate)
          )
          AND (ISNULL(vp.QTDE_CANCELADA, 0) = 0)
          ${filialFilter}
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
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
          )
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT
          v.DATA_VENDA,
          vt.TICKET,
          vt.QTDE AS QTDE_TROCA_ITEM,
          CAST((vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        WHERE vt.QTDE_CANCELADA = 0
          AND (
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
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
          ${filialFilter.replace(/f\.FILIAL/g, 'f.FILIAL')}
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
          CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6)) AS VALOR_TROCA,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA,
          CAST((CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6)) - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
        UNION ALL
        SELECT 
          tp.DATA_VENDA,
          tp.TICKET,
          tp.VALOR_TROCA_ITEM AS VALOR_TROCA,
          tp.QTDE_TROCA_ITEM AS QTDE_TROCA,
          tp.VALOR_LIQUIDO_CALC,
          tp.QTDE_LIQUIDA_CALC
        FROM TrocasPuras tp
      )
      SELECT
        SUM(CASE WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate THEN VALOR_LIQUIDO_CALC ELSE 0 END) AS currentRevenue,
        SUM(CASE WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate THEN VALOR_LIQUIDO_CALC ELSE 0 END) AS previousRevenue,
        SUM(CASE WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate THEN QTDE_LIQUIDA_CALC ELSE 0 END) AS currentQuantity,
        SUM(CASE WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate THEN QTDE_LIQUIDA_CALC ELSE 0 END) AS previousQuantity,
        COUNT(DISTINCT CASE WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate AND QTDE_LIQUIDA_CALC > 0 THEN TICKET ELSE NULL END) AS currentTickets,
        COUNT(DISTINCT CASE WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate AND QTDE_LIQUIDA_CALC > 0 THEN TICKET ELSE NULL END) AS previousTickets,
        MAX(CASE WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate THEN DATA_VENDA ELSE NULL END) AS currentLastSaleDate
      FROM MovimentoUnificado
    `;

    const fullQuery = `
      WITH vendas_base AS (
        SELECT 
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.DATA_VENDA,
          vp.PRODUTO,
          vp.COR_PRODUTO,
          vp.TAMANHO,
          vp.QTDE,
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_ITEM,
          vp.CUSTO,
          vp.FATOR_VENDA_LIQ,
          f.FILIAL,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRIFFE,
          p.GRADE,
          CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE CAST((vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6))
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vp.PRODUTO
        WHERE (
            (vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate)
            OR (vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate)
          )
          ${filialFilter}
          ${grupoFilter.replace(/vp\.GRUPO_PRODUTO/g, 'p.GRUPO_PRODUTO')}
          ${linhaFilter.replace(/vp\.LINHA/g, 'p.LINHA')}
          ${colecaoFilter.replace(/vp\.COLECAO/g, 'p.COLECAO')}
          ${subgrupoFilter.replace(/vp\.SUBGRUPO_PRODUTO/g, 'p.SUBGRUPO_PRODUTO')}
          ${gradeFilter}
          ${produtoFilter.replace(/vp\.DESC_PRODUTO/g, 'p.DESC_PRODUTO')}
          ${acimaDoTicketFilter}
          ${registrationDateFilter}
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
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
          )
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT 
          v.DATA_VENDA,
          vt.TICKET,
          vt.QTDE AS QTDE_TROCA_ITEM,
          CAST((vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vt.PRODUTO
        WHERE vt.QTDE_CANCELADA = 0
          AND (
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
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
          ${filialFilter.replace(/f\.FILIAL/g, 'f.FILIAL')}
          ${grupoFilter.replace(/vp\.GRUPO_PRODUTO/g, 'p.GRUPO_PRODUTO')}
          ${linhaFilter.replace(/vp\.LINHA/g, 'p.LINHA')}
          ${colecaoFilter.replace(/vp\.COLECAO/g, 'p.COLECAO')}
          ${subgrupoFilter.replace(/vp\.SUBGRUPO_PRODUTO/g, 'p.SUBGRUPO_PRODUTO')}
          ${gradeFilter}
          ${produtoFilter.replace(/vp\.DESC_PRODUTO/g, 'p.DESC_PRODUTO').replace(/vp\.PRODUTO/g, 'vt.PRODUTO')}
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
          CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6)) AS VALOR_TROCA,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA,
          CAST((CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6)) - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)

        UNION ALL

        SELECT 
          tp.DATA_VENDA,
          tp.TICKET,
          tp.VALOR_TROCA_ITEM AS VALOR_TROCA,
          tp.QTDE_TROCA_ITEM AS QTDE_TROCA,
          tp.VALOR_LIQUIDO_CALC,
          tp.QTDE_LIQUIDA_CALC
        FROM TrocasPuras tp
      )
      SELECT
        SUM(
          CASE
            WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate
            THEN VALOR_LIQUIDO_CALC
            ELSE 0
          END
        ) AS currentRevenue,
        SUM(
          CASE
            WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate
            THEN VALOR_LIQUIDO_CALC
            ELSE 0
          END
        ) AS previousRevenue,
        SUM(
          CASE
            WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate
            THEN QTDE_LIQUIDA_CALC
            ELSE 0
          END
        ) AS currentQuantity,
        SUM(
          CASE
            WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate
            THEN QTDE_LIQUIDA_CALC
            ELSE 0
          END
        ) AS previousQuantity,
        COUNT(DISTINCT CASE
          WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate
            AND QTDE_LIQUIDA_CALC > 0
          THEN TICKET
          ELSE NULL
        END) AS currentTickets,
        COUNT(DISTINCT CASE
          WHEN DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate
            AND QTDE_LIQUIDA_CALC > 0
          THEN TICKET
          ELSE NULL
        END) AS previousTickets,
        MAX(CASE
          WHEN DATA_VENDA >= @startDate AND DATA_VENDA < @endDate
          THEN DATA_VENDA
          ELSE NULL
        END) AS currentLastSaleDate
      FROM MovimentoUnificado
    `;

    const query = useLightQuery ? lightQuery : fullQuery;
    // Sequencial para evitar timeout no proxy/túnel (duas queries pesadas em paralelo estouravam)
    const result = await request.query<{
      currentRevenue: number | null;
      previousRevenue: number | null;
      currentQuantity: number | null;
      previousQuantity: number | null;
      currentTickets: number | null;
      previousTickets: number | null;
      currentLastSaleDate: Date | null;
    }>(query);
    const stockKpis = await fetchEstoqueKPIs({
      company,
      filial,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
      filterByRegistrationDate,
      range: currentRange,
    });

    const row = result.recordset[0] ?? {
      currentRevenue: 0,
      previousRevenue: 0,
      currentQuantity: 0,
      previousQuantity: 0,
      currentTickets: 0,
      previousTickets: 0,
      currentLastSaleDate: null,
    };

    const currentRevenue = Number(row.currentRevenue ?? 0);
    const previousRevenue = Number(row.previousRevenue ?? 0);

    const currentQuantity = Number(row.currentQuantity ?? 0);
    const previousQuantity = Number(row.previousQuantity ?? 0);

    const currentTickets = Number(row.currentTickets ?? 0);
    const previousTickets = Number(row.previousTickets ?? 0);

    const averageTicketCurrent =
      currentTickets > 0 ? Number((currentRevenue / currentTickets).toFixed(2)) : 0;
    const averageTicketPrevious =
      previousTickets > 0 ? Number((previousRevenue / previousTickets).toFixed(2)) : 0;

    const currentLastSaleDate = row.currentLastSaleDate;

    const buildMetric = (current: number, previous: number): MetricSummary => {
      if (previous === 0 && current === 0) {
        return {
          currentValue: current,
          previousValue: previous,
          changePercentage: 0,
        };
      }

      const changePercentage =
        previous === 0
          ? null
          : Number((((current - previous) / previous) * 100).toFixed(1));

      return {
        currentValue: current,
        previousValue: previous,
        changePercentage,
      };
    };

    const summary: SalesSummary = {
      totalRevenue: buildMetric(currentRevenue, previousRevenue),
      totalQuantity: buildMetric(currentQuantity, previousQuantity),
      totalTickets: buildMetric(currentTickets, previousTickets),
      averageTicket: buildMetric(averageTicketCurrent, averageTicketPrevious),
      totalStockQuantity: {
        currentValue: stockKpis.estoqueTotal,
        previousValue: stockKpis.estoqueTotal, // Estoque não tem histórico temporal
        changePercentage: null,
      },
      totalStockValue: {
        currentValue: stockKpis.valorEmEstoque,
        previousValue: stockKpis.valorEmEstoque, // Estoque não tem histórico temporal
        changePercentage: null,
      },
    };

    const lastSaleDate = currentLastSaleDate
      ? new Date(currentLastSaleDate)
      : null;

    // Buscar disponibilidade de datas usando withRequest para suportar proxy
    const availabilityRow = await withRequest(async (availabilityRequest) => {
      const availabilityFilter = buildFilialFilter(availabilityRequest, company, 'sales', filial);
      const availabilityQuery = `
        SELECT
          MIN(vp.DATA_VENDA) AS firstSaleDate,
          MAX(vp.DATA_VENDA) AS lastSaleDate
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.QTDE > 0
          ${availabilityFilter}
      `;

      const availabilityResult = await availabilityRequest.query<{
        firstSaleDate: Date | null;
        lastSaleDate: Date | null;
      }>(availabilityQuery);

      return availabilityResult.recordset[0] ?? {
        firstSaleDate: null,
        lastSaleDate: null,
      };
    });

    return {
      summary,
      currentPeriodLastSaleDate: lastSaleDate,
      availableRange: {
        start: availabilityRow.firstSaleDate
          ? new Date(availabilityRow.firstSaleDate)
          : null,
        end: availabilityRow.lastSaleDate
          ? new Date(availabilityRow.lastSaleDate)
          : null,
      },
    };
  });
}

export async function fetchTopCategories({
  limit = DEFAULT_LIMIT,
  company,
  range,
  filial,
}: TopQueryParams = {}): Promise<CategoryRevenue[]> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchTopCategoriesEcommerce({ limit, company, range, filial });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    // Buscar categorias de vendas normais e ecommerce em paralelo
    const [salesCategories, ecommerceCategories] = await Promise.all([
      fetchTopCategories({ limit: limit * 2, company, range, filial: VAREJO_VALUE }),
      fetchTopCategoriesEcommerce({ limit: limit * 2, company, range, filial: null }),
    ]);

    // Agregar categorias por categoryId
    const categoryMap = new Map<string, CategoryRevenue>();

    // Adicionar categorias de vendas normais
    salesCategories.forEach((category) => {
      categoryMap.set(category.categoryId, { ...category });
    });

    // Agregar categorias de ecommerce
    ecommerceCategories.forEach((category) => {
      const existing = categoryMap.get(category.categoryId);
      if (existing) {
        existing.totalRevenue += category.totalRevenue;
        existing.totalQuantity += category.totalQuantity;
      } else {
        categoryMap.set(category.categoryId, { ...category });
      }
    });

    // Converter para array, ordenar por revenue e pegar os top N
    const aggregated = Array.from(categoryMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    return aggregated;
  }

  // Função normal para vendas de loja
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilterBase = buildFilialFilter(request, company, 'sales', filial, 'f');
    const filialFilter = filialFilterBase.replace(/f\.FILIAL/g, 'f.FILIAL').replace(/AND f\.FILIAL/g, 'AND f.FILIAL');

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
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_ITEM,
          vp.CUSTO,
          vp.FATOR_VENDA_LIQ,
          f.FILIAL,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRIFFE,
          p.GRADE,
          (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DESCONTO_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0))
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vp.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          ${filialFilter}
      ),
      trocas_item AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT 
          vt.TICKET,
          vt.CODIGO_FILIAL,
          v.DATA_VENDA,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          0 AS QTDE,
          0 AS QTDE_CANCELADA,
          vt.PRECO_LIQUIDO,
          vt.DESCONTO_ITEM,
          vt.CUSTO,
          NULL AS FATOR_VENDA_LIQ,
          f.FILIAL,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRIFFE,
          p.GRADE,
          0 AS DESCONTO_VENDA,
          0 AS TOTAL_VENDA,
          0 AS TOTAL_QTDE_VENDA,
          vt.QTDE AS QTDE_TROCA_ITEM,
          CAST((vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vt.PRODUTO
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @startDate
          AND v.DATA_VENDA < @endDate
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
          ${filialFilter.replace(/f\.FILIAL/g, 'f.FILIAL')}
      ),
      VendasComNumero AS (
        SELECT 
          vb.*,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM vendas_base vb
      ),
      vendas_com_troca AS (
        SELECT 
          vcn.TICKET,
          vcn.CODIGO_FILIAL,
          vcn.DATA_VENDA,
          vcn.PRODUTO,
          vcn.COR_PRODUTO,
          vcn.TAMANHO,
          vcn.QTDE,
          vcn.QTDE_CANCELADA,
          vcn.PRECO_LIQUIDO,
          vcn.DESCONTO_ITEM,
          vcn.CUSTO,
          vcn.FATOR_VENDA_LIQ,
          vcn.FILIAL,
          vcn.DESC_PRODUTO,
          vcn.GRUPO_PRODUTO,
          vcn.SUBGRUPO_PRODUTO,
          vcn.LINHA,
          vcn.COLECAO,
          vcn.GRIFFE,
          vcn.GRADE,
          vcn.DESCONTO_VENDA,
          vcn.TOTAL_VENDA,
          vcn.TOTAL_QTDE_VENDA,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA_ITEM,
          CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6)) - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT * FROM vendas_com_troca
        UNION ALL
        SELECT * FROM TrocasPuras
      )
      SELECT TOP (@limit)
        COALESCE(GRUPO_PRODUTO, 'SEM GRUPO') AS categoryId,
        COALESCE(MAX(GRUPO_PRODUTO), 'SEM GRUPO') AS categoryName,
        SUM(VALOR_LIQUIDO_CALC) AS totalRevenue,
        SUM(QTDE_LIQUIDA_CALC) AS totalQuantity
      FROM vendas_finais
      GROUP BY COALESCE(GRUPO_PRODUTO, 'SEM GRUPO')
      ORDER BY totalRevenue DESC;
    `;

    const result = await request.query<CategoryRevenue>(query);

    return result.recordset.map((row) => ({
      ...row,
      totalRevenue: Number(row.totalRevenue ?? 0),
      totalQuantity: Number(row.totalQuantity ?? 0),
    }));
  });
}

export interface DailyRevenue {
  date: string;
  revenue: number;
}

export async function fetchDailyRevenue({
  company,
  range,
  filial,
}: SummaryQueryParams = {}): Promise<DailyRevenue[]> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchDailyEcommerceRevenue({ company, range, filial });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    // Buscar receita diária de vendas normais e ecommerce em paralelo
    const [salesDaily, ecommerceDaily] = await Promise.all([
      fetchDailyRevenue({ company, range, filial: VAREJO_VALUE }),
      fetchDailyEcommerceRevenue({ company, range, filial: null }),
    ]);

    // Agregar por data
    const dateMap = new Map<string, DailyRevenue>();

    // Adicionar receita de vendas normais
    salesDaily.forEach((day) => {
      dateMap.set(day.date, { ...day });
    });

    // Agregar receita de ecommerce
    ecommerceDaily.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.revenue += day.revenue;
      } else {
        dateMap.set(day.date, { ...day });
      }
    });

    // Converter para array e ordenar por data
    return Array.from(dateMap.values()).sort((a, b) => 
      a.date.localeCompare(b.date)
    );
  }

  // Função normal para vendas de loja
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial);

    const query = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
      ),
      trocas_item AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          SUM((vt.PRECO_LIQUIDO * vt.QTDE) - ISNULL(vt.DESCONTO_ITEM, 0)) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      trocas_ticket AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          SUM(vt.QTDE) AS QTDE_TROCA_TICKET,
          SUM((vt.PRECO_LIQUIDO * vt.QTDE) - ISNULL(vt.DESCONTO_ITEM, 0)) AS VALOR_TROCA_TICKET
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM,
          ISNULL(tt.QTDE_TROCA_TICKET, 0) AS QTDE_TROCA_TICKET,
          ISNULL(tt.VALOR_TROCA_TICKET, 0) AS VALOR_TROCA_TICKET,
          SUM(vb.TOTAL_VENDA) OVER (PARTITION BY vb.TICKET, vb.CODIGO_FILIAL) AS TOTAL_VENDA_TICKET
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
        LEFT JOIN trocas_ticket tt ON tt.TICKET = vb.TICKET 
          AND tt.CODIGO_FILIAL = vb.CODIGO_FILIAL
      ),
      vendas_liquidas AS (
        SELECT 
          *,
          CASE 
            WHEN TOTAL_VENDA_TICKET > 0 THEN CAST(TOTAL_VENDA AS FLOAT) / CAST(TOTAL_VENDA_TICKET AS FLOAT)
            ELSE 0
          END AS PROPORCAO
        FROM vendas_com_troca
      ),
      vendas_finais AS (
        SELECT 
          *,
          CASE 
            WHEN ISNULL(QTDE_TROCA_ITEM, 0) > 0 THEN ISNULL(QTDE_TROCA_ITEM, 0)
            ELSE ISNULL(QTDE_TROCA_TICKET, 0) * PROPORCAO
          END AS QTDE_TROCA,
          CASE 
            WHEN ISNULL(VALOR_TROCA_ITEM, 0) > 0 THEN ISNULL(VALOR_TROCA_ITEM, 0)
            ELSE ISNULL(VALOR_TROCA_TICKET, 0) * PROPORCAO
          END AS VALOR_TROCA
        FROM vendas_liquidas
      )
      SELECT
        CAST(DATA_VENDA AS DATE) AS date,
        SUM(TOTAL_VENDA - VALOR_TROCA) AS revenue
      FROM vendas_finais
      GROUP BY CAST(DATA_VENDA AS DATE)
      ORDER BY date ASC;
    `;

    const result = await request.query<{
      date: Date;
      revenue: number | null;
    }>(query);

    return result.recordset.map((row) => {
      // Converter para Date se for string (vindo do proxy)
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      return {
        date: date.toISOString().split('T')[0],
        revenue: Number(row.revenue ?? 0),
      };
    });
  });
}

export async function fetchFilialPerformance({
  company,
  range,
}: SummaryQueryParams = {}): Promise<FilialPerformance[]> {
  const companyConfig = resolveCompany(company);
  if (!companyConfig) {
    return [];
  }

  // Buscar performance de filiais normais
  const normalFiliais = withRequest(async (request) => {
    const currentRange = resolveRange(range);
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);
    // Período anterior = mesmos dias (ex.: 1 a 5 → 1 a 5 do mês anterior). End exclusivo.

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, previousRange.end);

    const filiais = companyConfig.filialFilters['sales'] ?? [];
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    const normalFiliaisList = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliaisList.length === 0) {
      return [];
    }

    // Criar filtro para todas as filiais normais da empresa
    normalFiliaisList.forEach((filial, index) => {
      request.input(`filial${index}`, sql.VarChar, filial);
    });
    const placeholders = normalFiliaisList.map((_, index) => `@filial${index}`).join(', ');

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
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_ITEM,
          vp.CUSTO,
          vp.FATOR_VENDA_LIQ,
          f.FILIAL,
          CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE CAST((vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6))
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        WHERE (
            (vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate)
            OR (vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate)
          )
          AND f.FILIAL IN (${placeholders})
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
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
          )
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          v.DATA_VENDA,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          0 AS QTDE,
          0 AS QTDE_CANCELADA,
          vt.PRECO_LIQUIDO,
          vt.DESCONTO_ITEM,
          vt.CUSTO,
          NULL AS FATOR_VENDA_LIQ,
          f.FILIAL,
          0 AS DESCONTO_VENDA,
          0 AS TOTAL_VENDA,
          0 AS TOTAL_QTDE_VENDA,
          vt.QTDE AS QTDE_TROCA_ITEM,
          CAST((vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        WHERE vt.QTDE_CANCELADA = 0
          AND (
            (v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate)
            OR (v.DATA_VENDA >= @prevStartDate AND v.DATA_VENDA < @prevEndDate)
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
          AND f.FILIAL IN (${placeholders})
      ),
      VendasComNumero AS (
        SELECT 
          vb.*,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM vendas_base vb
      ),
      vendas_com_troca AS (
        SELECT 
          vcn.TICKET,
          vcn.CODIGO_FILIAL,
          vcn.DATA_VENDA,
          vcn.PRODUTO,
          vcn.COR_PRODUTO,
          vcn.TAMANHO,
          vcn.QTDE,
          vcn.QTDE_CANCELADA,
          vcn.PRECO_LIQUIDO,
          vcn.DESCONTO_ITEM,
          vcn.CUSTO,
          vcn.FATOR_VENDA_LIQ,
          vcn.FILIAL,
          vcn.DESCONTO_VENDA,
          vcn.TOTAL_VENDA,
          vcn.TOTAL_QTDE_VENDA,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA_ITEM,
          CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM,
          CAST((CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6)) - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT * FROM vendas_com_troca
        UNION ALL
        SELECT * FROM TrocasPuras
      ),
      filial_revenue AS (
        SELECT
          FILIAL,
          'current' AS period,
          SUM(VALOR_LIQUIDO_CALC) AS revenue
        FROM vendas_finais
        WHERE DATA_VENDA >= @startDate AND DATA_VENDA < @endDate
        GROUP BY FILIAL

        UNION ALL

        SELECT
          FILIAL,
          'previous' AS period,
          SUM(VALOR_LIQUIDO_CALC) AS revenue
        FROM vendas_finais
        WHERE DATA_VENDA >= @prevStartDate AND DATA_VENDA < @prevEndDate
        GROUP BY FILIAL
      )
      SELECT
        fr.FILIAL,
        COALESCE(MAX(CASE WHEN fr.period = 'current' THEN fr.revenue END), 0) AS currentRevenue,
        COALESCE(MAX(CASE WHEN fr.period = 'previous' THEN fr.revenue END), 0) AS previousRevenue
      FROM filial_revenue fr
      GROUP BY fr.FILIAL
      ORDER BY currentRevenue DESC;
    `;

    const result = await request.query<{
      FILIAL: string;
      currentRevenue: number | null;
      previousRevenue: number | null;
    }>(query);

    return result.recordset;
  });

  // Buscar performance de filiais de e-commerce
  const ecommerceFiliais = fetchEcommerceFilialPerformance({ company, range });

  // Combinar resultados
  const [normalResults, ecommerceResults] = await Promise.all([
    normalFiliais,
    ecommerceFiliais,
  ]);

  const displayNames = companyConfig.filialDisplayNames ?? {};

  // Combinar e ordenar por revenue atual
  const combined = [
    ...normalResults.map((row) => {
      const current = Number(row.currentRevenue ?? 0);
      const previous = Number(row.previousRevenue ?? 0);
      
      // Normalizar o nome da filial (remover espaços extras)
      const filial = String(row.FILIAL ?? '').trim();
      
      let changePercentage: number | null = null;
      if (previous > 0) {
        changePercentage = Number((((current - previous) / previous) * 100).toFixed(1));
      } else if (current > 0) {
        changePercentage = null;
      }

      return {
        filial: filial,
        filialDisplayName: displayNames[filial] ?? filial,
        currentRevenue: current,
        previousRevenue: previous,
        changePercentage,
      };
    }),
    ...ecommerceResults, // Já vem com filialDisplayName correto
  ];

  // Ordenar por revenue atual (maior primeiro)
  return combined.sort((a, b) => b.currentRevenue - a.currentRevenue);
}
