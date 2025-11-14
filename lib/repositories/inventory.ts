import sql from 'mssql';

import { resolveCompany } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';

function buildFilialFilter(
  request: sql.Request,
  companySlug: string | undefined,
  specificFilial?: string | null,
  prefix: string = 'e'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial) {
    const filialParam = `estoqueFilial`;
    request.input(filialParam, sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @${filialParam}`;
  }

  // Caso contrário, usar todas as filiais da empresa (módulo inventory)
  const filiais = company.filialFilters['inventory'] ?? [];

  if (filiais.length === 0) {
    return '';
  }

  filiais.forEach((filial, index) => {
    request.input(`estoqueFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = filiais
    .map((_, index) => `@estoqueFilial${index}`)
    .join(', ');

  return `AND ${prefix}.FILIAL IN (${placeholders})`;
}

export interface ProductStockParams {
  company?: string;
  filial?: string | null;
}

export interface ProductStock {
  productId: string;
  stock: number;
}

/**
 * Busca o estoque total de um produto específico
 * Se filial for especificada, retorna estoque apenas daquela filial
 * Caso contrário, retorna estoque total de todas as filiais da empresa
 */
export async function fetchProductStock(
  productId: string,
  { company, filial }: ProductStockParams = {}
): Promise<number> {
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);

    const filialFilter = buildFilialFilter(request, company, filial);

    const query = `
      SELECT 
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
        ${filialFilter}
    `;

    const result = await request.query<{
      positiveStock: number | null;
      negativeStock: number | null;
      positiveCount: number | null;
    }>(query);
    
    const row = result.recordset[0] ?? {
      positiveStock: 0,
      negativeStock: 0,
      positiveCount: 0,
    };
    
    const positiveStock = Number(row.positiveStock ?? 0);
    const negativeStock = Number(row.negativeStock ?? 0);
    const positiveCount = Number(row.positiveCount ?? 0);
    
    // Se houver estoque positivo, usar apenas a soma dos positivos
    // Caso contrário, usar a soma dos negativos
    const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
    
    return finalStock;
  });
}

/**
 * Busca o estoque de múltiplos produtos de uma vez
 * Retorna um mapa de productId -> stock
 */
export async function fetchMultipleProductsStock(
  productIds: string[],
  { company, filial }: ProductStockParams = {}
): Promise<Map<string, number>> {
  if (productIds.length === 0) {
    return new Map();
  }

  return withRequest(async (request) => {
    const filialFilter = buildFilialFilter(request, company, filial);

    // Criar placeholders para os IDs dos produtos
    const productPlaceholders = productIds
      .map((_, index) => {
        const paramName = `productId${index}`;
        request.input(paramName, sql.VarChar, productIds[index]);
        return `@${paramName}`;
      })
      .join(', ');

    const query = `
      SELECT 
        e.PRODUTO AS productId,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO IN (${productPlaceholders})
        ${filialFilter}
      GROUP BY e.PRODUTO
    `;

    const result = await request.query<{
      productId: string;
      positiveStock: number | null;
      negativeStock: number | null;
      positiveCount: number | null;
    }>(query);

    const stockMap = new Map<string, number>();
    result.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      
      // Se houver estoque positivo, usar apenas a soma dos positivos
      // Caso contrário, usar a soma dos negativos
      const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      
      stockMap.set(row.productId, finalStock);
    });

    // Garantir que todos os produtos tenham entrada no mapa (mesmo que com 0)
    productIds.forEach((id) => {
      if (!stockMap.has(id)) {
        stockMap.set(id, 0);
      }
    });

    return stockMap;
  });
}

