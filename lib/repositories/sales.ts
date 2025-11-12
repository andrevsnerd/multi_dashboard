import sql from 'mssql';

import { resolveCompany } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import type { CategoryRevenue, ProductRevenue } from '@/types/dashboard';

const DEFAULT_LIMIT = 5;
const DEFAULT_DAYS = 90;

function buildSinceDate(days: number): Date {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

function buildFilialFilter(
  request: sql.Request,
  companySlug?: string
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company || company.filialCodes.length === 0) {
    return '';
  }

  company.filialCodes.forEach((filial, index) => {
    request.input(`filial${index}`, sql.VarChar, filial);
  });

  const placeholders = company.filialCodes
    .map((_, index) => `@filial${index}`)
    .join(', ');

  return `AND vp.FILIAL IN (${placeholders})`;
}

export interface TopQueryParams {
  limit?: number;
  days?: number;
  company?: string;
}

export async function fetchTopProducts({
  limit = DEFAULT_LIMIT,
  days = DEFAULT_DAYS,
  company,
}: TopQueryParams = {}): Promise<ProductRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    request.input('since', sql.DateTime, buildSinceDate(days));

    const filialFilter = buildFilialFilter(request, company);

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
      WHERE vp.DATA_VENDA >= @since
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

export async function fetchTopCategories({
  limit = DEFAULT_LIMIT,
  days = DEFAULT_DAYS,
  company,
}: TopQueryParams = {}): Promise<CategoryRevenue[]> {
  return withRequest(async (request) => {
    request.input('limit', sql.Int, limit);
    request.input('since', sql.DateTime, buildSinceDate(days));

    const filialFilter = buildFilialFilter(request, company);

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
      WHERE vp.DATA_VENDA >= @since
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


