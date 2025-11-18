import sql from 'mssql';

import { resolveCompany, type CompanyModule } from '@/lib/config/company';
import { getConnectionPool, withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
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

function buildEcommerceFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  specificFilial?: string | null,
  tableAlias: string = 'f'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  // Se uma filial específica foi selecionada
  if (specificFilial) {
    request.input('ecommerceFilial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @ecommerceFilial`;
  }

  // Caso contrário, usar todas as filiais de e-commerce da empresa
  const ecommerceFilials = company.ecommerceFilials ?? [];
  
  if (ecommerceFilials.length === 0) {
    return '';
  }

  ecommerceFilials.forEach((filial, index) => {
    request.input(`ecommerceFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = ecommerceFilials
    .map((_, index) => `@ecommerceFilial${index}`)
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

export async function fetchTopProductsEcommerce({
  limit = DEFAULT_LIMIT,
  company,
  range,
  filial,
}: TopQueryParams = {}): Promise<ProductRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildEcommerceFilialFilter(request, company, filial);

    const query = `
      SELECT TOP (@limit)
        fp.PRODUTO AS productId,
        MAX(p.DESC_PRODUTO) AS productName,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      GROUP BY fp.PRODUTO
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

export async function fetchEcommerceSummary({
  company,
  range,
  filial,
}: SummaryQueryParams = {}): Promise<SalesSummaryResult> {
  return withRequest(async (request) => {
    const currentRange = resolveRange(range);
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);
    
    // Ajustar o fim do período anterior para 1 dia antes do fim do período atual
    // Isso garante comparação justa, já que o dia atual ainda não está completo
    const adjustedPreviousEnd = new Date(previousRange.end);
    adjustedPreviousEnd.setTime(adjustedPreviousEnd.getTime() - 24 * 60 * 60 * 1000); // Subtrair 1 dia

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, adjustedPreviousEnd);

    const filialFilter = buildEcommerceFilialFilter(request, company, filial);

    const query = `
      WITH summary AS (
        SELECT
          'current' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
          SUM(fp.QTDE) AS totalQuantity,
          COUNT(DISTINCT CONCAT(f.NF_SAIDA, '-', f.SERIE_NF)) AS totalTickets,
          MAX(f.EMISSAO) AS lastSaleDate
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= @startDate
          AND f.EMISSAO < @endDate
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}

        UNION ALL

        SELECT
          'previous' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
          SUM(fp.QTDE) AS totalQuantity,
          COUNT(DISTINCT CONCAT(f.NF_SAIDA, '-', f.SERIE_NF)) AS totalTickets,
          MAX(f.EMISSAO) AS lastSaleDate
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= @prevStartDate
          AND f.EMISSAO < @prevEndDate
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}
      )
      SELECT period, totalRevenue, totalQuantity, totalTickets, lastSaleDate FROM summary;
    `;

    const result = await request.query<{
      period: 'current' | 'previous';
      totalRevenue: number | null;
      totalQuantity: number | null;
      totalTickets: number | null;
      lastSaleDate: Date | null;
    }>(query);

    const currentRow =
      result.recordset.find((row) => row.period === 'current') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
        lastSaleDate: null,
      };
    const previousRow =
      result.recordset.find((row) => row.period === 'previous') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
        lastSaleDate: null,
      };

    const currentRevenue = Number(currentRow.totalRevenue ?? 0);
    const previousRevenue = Number(previousRow.totalRevenue ?? 0);

    const currentQuantity = Number(currentRow.totalQuantity ?? 0);
    const previousQuantity = Number(previousRow.totalQuantity ?? 0);

    const currentTickets = Number(currentRow.totalTickets ?? 0);
    const previousTickets = Number(previousRow.totalTickets ?? 0);

    const averageTicketCurrent =
      currentTickets > 0 ? Number((currentRevenue / currentTickets).toFixed(2)) : 0;
    const averageTicketPrevious =
      previousTickets > 0 ? Number((previousRevenue / previousTickets).toFixed(2)) : 0;

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

    const lastSaleDate = currentRow.lastSaleDate
      ? new Date(currentRow.lastSaleDate)
      : null;

    const pool = await getConnectionPool();
    const availabilityRequest = pool.request();
    const availabilityFilter = buildEcommerceFilialFilter(availabilityRequest, company, filial);
    const availabilityQuery = `
      SELECT
        MIN(f.EMISSAO) AS firstSaleDate,
        MAX(f.EMISSAO) AS lastSaleDate
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
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

export async function fetchTopCategoriesEcommerce({
  limit = DEFAULT_LIMIT,
  company,
  range,
  filial,
}: TopQueryParams = {}): Promise<CategoryRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildEcommerceFilialFilter(request, company, filial);

    const query = `
      SELECT TOP (@limit)
        COALESCE(p.GRUPO_PRODUTO, 'SEM GRUPO') AS categoryId,
        COALESCE(MAX(p.GRUPO_PRODUTO), 'SEM GRUPO') AS categoryName,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      GROUP BY COALESCE(p.GRUPO_PRODUTO, 'SEM GRUPO')
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

export async function fetchDailyEcommerceRevenue({
  company,
  range,
  filial,
}: SummaryQueryParams = {}): Promise<DailyRevenue[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildEcommerceFilialFilter(request, company, filial);

    const query = `
      SELECT
        CAST(f.EMISSAO AS DATE) AS date,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS revenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      GROUP BY CAST(f.EMISSAO AS DATE)
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

export async function fetchEcommerceFilialPerformance({
  company,
  range,
}: SummaryQueryParams = {}): Promise<FilialPerformance[]> {
  return withRequest(async (request) => {
    const currentRange = resolveRange(range);
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);
    
    // Ajustar o fim do período anterior para 1 dia antes do fim do período atual
    const adjustedPreviousEnd = new Date(previousRange.end);
    adjustedPreviousEnd.setTime(adjustedPreviousEnd.getTime() - 24 * 60 * 60 * 1000); // Subtrair 1 dia

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, adjustedPreviousEnd);

    const companyConfig = resolveCompany(company);
    if (!companyConfig) {
      return [];
    }

    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    if (ecommerceFilials.length === 0) {
      return [];
    }

    // Criar filtro para todas as filiais de e-commerce da empresa
    ecommerceFilials.forEach((filial, index) => {
      request.input(`ecommerceFilial${index}`, sql.VarChar, filial);
    });
    const placeholders = ecommerceFilials.map((_, index) => `@ecommerceFilial${index}`).join(', ');

    const query = `
      WITH filial_revenue AS (
        SELECT
          f.FILIAL,
          'current' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS revenue
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= @startDate
          AND f.EMISSAO < @endDate
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
        GROUP BY f.FILIAL

        UNION ALL

        SELECT
          f.FILIAL,
          'previous' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS revenue
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= @prevStartDate
          AND f.EMISSAO < @prevEndDate
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
        GROUP BY f.FILIAL
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

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => {
      const current = Number(row.currentRevenue ?? 0);
      const previous = Number(row.previousRevenue ?? 0);
      
      // Normalizar o nome da filial (remover espaços extras)
      const filial = String(row.FILIAL ?? '').trim();
      
      let changePercentage: number | null = null;
      if (previous > 0) {
        changePercentage = Number((((current - previous) / previous) * 100).toFixed(1));
      } else if (current > 0) {
        changePercentage = null; // Não há comparação possível
      }

      return {
        filial: filial,
        filialDisplayName: displayNames[filial] ?? filial,
        currentRevenue: current,
        previousRevenue: previous,
        changePercentage,
      };
    });
  });
}

