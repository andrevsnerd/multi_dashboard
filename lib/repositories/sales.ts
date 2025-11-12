import sql from 'mssql';

import { resolveCompany, type CompanyModule } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import type {
  CategoryRevenue,
  ProductRevenue,
  SalesSummary,
  DateRangeInput,
  MetricSummary,
} from '@/types/dashboard';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';

const DEFAULT_LIMIT = 5;

function resolveRange(range?: DateRangeInput) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

function buildFilialFilter(
  request: sql.Request,
  companySlug: string | undefined,
  module: CompanyModule
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  const filiais = company.filialFilters[module] ?? [];

  if (filiais.length === 0) {
    return '';
  }

  filiais.forEach((filial, index) => {
    request.input(`filial${index}`, sql.VarChar, filial);
  });

  const placeholders = filiais
    .map((_, index) => `@filial${index}`)
    .join(', ');

  return `AND vp.FILIAL IN (${placeholders})`;
}

export interface TopQueryParams {
  limit?: number;
  company?: string;
  range?: DateRangeInput;
}

export interface SummaryQueryParams {
  company?: string;
  range?: DateRangeInput;
}

export async function fetchTopProducts({
  limit = DEFAULT_LIMIT,
  company,
  range,
}: TopQueryParams = {}): Promise<ProductRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales');

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

    return result.recordset.map((row) => ({
      ...row,
      totalRevenue: Number(row.totalRevenue ?? 0),
      totalQuantity: Number(row.totalQuantity ?? 0),
    }));
  });
}

export async function fetchSalesSummary({
  company,
  range,
}: SummaryQueryParams = {}): Promise<SalesSummary> {
  return withRequest(async (request) => {
    const currentRange = resolveRange(range);
    const { start, end } = currentRange;
    const previousRange = shiftRangeByMonths(currentRange, -1);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('prevStartDate', sql.DateTime, previousRange.start);
    request.input('prevEndDate', sql.DateTime, previousRange.end);

    const filialFilter = buildFilialFilter(request, company, 'sales');

    const query = `
      WITH summary AS (
        SELECT
          'current' AS period,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            END
          ) AS totalRevenue,
          SUM(vp.QTDE) AS totalQuantity,
          COUNT(DISTINCT vp.TICKET) AS totalTickets
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}

        UNION ALL

        SELECT
          'previous' AS period,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            END
          ) AS totalRevenue,
          SUM(vp.QTDE) AS totalQuantity,
          COUNT(DISTINCT vp.TICKET) AS totalTickets
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @prevStartDate
          AND vp.DATA_VENDA < @prevEndDate
          AND vp.QTDE > 0
          ${filialFilter}
      )
      SELECT period, totalRevenue, totalQuantity, totalTickets FROM summary;
    `;

    const result = await request.query<{
      period: 'current' | 'previous';
      totalRevenue: number | null;
      totalQuantity: number | null;
      totalTickets: number | null;
    }>(query);

    const currentRow =
      result.recordset.find((row) => row.period === 'current') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
      };
    const previousRow =
      result.recordset.find((row) => row.period === 'previous') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
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

    return {
      totalRevenue: buildMetric(currentRevenue, previousRevenue),
      totalQuantity: buildMetric(currentQuantity, previousQuantity),
      totalTickets: buildMetric(currentTickets, previousTickets),
      averageTicket: buildMetric(averageTicketCurrent, averageTicketPrevious),
    };
  });
}

export async function fetchTopCategories({
  limit = DEFAULT_LIMIT,
  company,
  range,
}: TopQueryParams = {}): Promise<CategoryRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales');

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


