import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import {
  fetchEcommerceSummary,
  fetchTopProductsEcommerce,
  fetchTopCategoriesEcommerce,
  fetchDailyEcommerceRevenue,
  fetchEcommerceFilialPerformance,
} from '@/lib/repositories/ecommerce';
import { getConnectionPool, withRequest } from '@/lib/db/connection';
import { fetchMultipleProductsStock, fetchStockSummary } from '@/lib/repositories/inventory';
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
  request: sql.Request,
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

    const filialFilter = buildFilialFilter(request, company, 'sales', filial);

    const query = `
      SELECT TOP (@limit)
        vp.PRODUTO AS productId,
        MAX(vp.DESC_PRODUTO) AS productName,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue,
        SUM(vp.QTDE) AS totalQuantity
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY vp.PRODUTO
      ORDER BY totalRevenue DESC;
    `;

    const result = await request.query<ProductRevenue>(query);

    const products = result.recordset.map((row) => ({
      ...row,
      totalRevenue: Number(row.totalRevenue ?? 0),
      totalQuantity: Number(row.totalQuantity ?? 0),
      stock: 0, // Será preenchido abaixo
    }));

    // Buscar estoque para todos os produtos de uma vez
    if (products.length > 0) {
      const productIds = products.map((p) => p.productId);
      const stockMap = await fetchMultipleProductsStock(productIds, {
        company,
        filial,
      });

      // Adicionar estoque a cada produto
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
}: SummaryQueryParams = {}): Promise<SalesSummaryResult> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchEcommerceSummary({ company, range, filial });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    // Buscar vendas normais (varejo) e ecommerce em paralelo
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchSalesSummary({ company, range, filial: VAREJO_VALUE }),
      fetchEcommerceSummary({ company, range, filial: null }),
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
      totalStockQuantity: salesResult.summary.totalStockQuantity,
      totalStockValue: salesResult.summary.totalStockValue,
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
    const currentRange = resolveRange(range);
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, previousRange.end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial);

    // Otimizar query usando uma única passada pela tabela com CASE para separar períodos
    // Isso é mais eficiente que UNION ALL com duas queries separadas
    const query = `
      SELECT
        SUM(
          CASE
            WHEN vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate
              AND vp.QTDE_CANCELADA = 0
            THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            ELSE 0
          END
        ) AS currentRevenue,
        SUM(
          CASE
            WHEN vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate
              AND vp.QTDE_CANCELADA = 0
            THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            ELSE 0
          END
        ) AS previousRevenue,
        SUM(
          CASE
            WHEN vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate
              AND vp.QTDE > 0
            THEN vp.QTDE
            ELSE 0
          END
        ) AS currentQuantity,
        SUM(
          CASE
            WHEN vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate
              AND vp.QTDE > 0
            THEN vp.QTDE
            ELSE 0
          END
        ) AS previousQuantity,
        COUNT(DISTINCT CASE
          WHEN vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate
            AND vp.QTDE > 0
          THEN vp.TICKET
          ELSE NULL
        END) AS currentTickets,
        COUNT(DISTINCT CASE
          WHEN vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate
            AND vp.QTDE > 0
          THEN vp.TICKET
          ELSE NULL
        END) AS previousTickets,
        MAX(CASE
          WHEN vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate
          THEN vp.DATA_VENDA
          ELSE NULL
        END) AS currentLastSaleDate
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE (
          (vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate)
          OR (vp.DATA_VENDA >= @prevStartDate AND vp.DATA_VENDA < @prevEndDate)
        )
        AND vp.QTDE > 0
        ${filialFilter}
    `;

    const result = await request.query<{
      currentRevenue: number | null;
      previousRevenue: number | null;
      currentQuantity: number | null;
      previousQuantity: number | null;
      currentTickets: number | null;
      previousTickets: number | null;
      currentLastSaleDate: Date | null;
    }>(query);

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

    // Buscar resumo de estoque
    const stockSummary = await fetchStockSummary({
      company,
      filial,
    });

    const summary: SalesSummary = {
      totalRevenue: buildMetric(currentRevenue, previousRevenue),
      totalQuantity: buildMetric(currentQuantity, previousQuantity),
      totalTickets: buildMetric(currentTickets, previousTickets),
      averageTicket: buildMetric(averageTicketCurrent, averageTicketPrevious),
      totalStockQuantity: {
        currentValue: stockSummary.totalQuantity,
        previousValue: stockSummary.totalQuantity, // Estoque não tem histórico temporal
        changePercentage: null,
      },
      totalStockValue: {
        currentValue: stockSummary.totalValue,
        previousValue: stockSummary.totalValue, // Estoque não tem histórico temporal
        changePercentage: null,
      },
    };

    const lastSaleDate = currentLastSaleDate
      ? new Date(currentLastSaleDate)
      : null;

    const pool = await getConnectionPool();
    const availabilityRequest = pool.request();
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

    const availabilityRow = availabilityResult.recordset[0] ?? {
      firstSaleDate: null,
      lastSaleDate: null,
    };

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

    const filialFilter = buildFilialFilter(request, company, 'sales', filial);

    const query = `
      SELECT TOP (@limit)
        COALESCE(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS categoryId,
        COALESCE(MAX(vp.GRUPO_PRODUTO), 'SEM GRUPO') AS categoryName,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue,
        SUM(vp.QTDE) AS totalQuantity
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY COALESCE(vp.GRUPO_PRODUTO, 'SEM GRUPO')
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
      SELECT
        CAST(vp.DATA_VENDA AS DATE) AS date,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS revenue
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY CAST(vp.DATA_VENDA AS DATE)
      ORDER BY date ASC;
    `;

    const result = await request.query<{
      date: Date;
      revenue: number | null;
    }>(query);

    return result.recordset.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      revenue: Number(row.revenue ?? 0),
    }));
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
      WITH filial_revenue AS (
        SELECT
          vp.FILIAL,
          'current' AS period,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            END
          ) AS revenue
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          AND vp.FILIAL IN (${placeholders})
        GROUP BY vp.FILIAL

        UNION ALL

        SELECT
          vp.FILIAL,
          'previous' AS period,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            END
          ) AS revenue
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @prevStartDate
          AND vp.DATA_VENDA < @prevEndDate
          AND vp.QTDE > 0
          AND vp.FILIAL IN (${placeholders})
        GROUP BY vp.FILIAL
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


