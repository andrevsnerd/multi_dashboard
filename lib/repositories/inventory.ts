import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import type { MetricSummary } from '@/types/dashboard';

function buildFilialFilter(
  request: sql.Request | RequestLike,
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

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    const filialParam = `estoqueFilial`;
    request.input(filialParam, sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @${filialParam}`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`estoqueFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@estoqueFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
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
      request.input(`estoqueFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@estoqueFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`estoqueFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
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

export interface StockSummaryParams {
  company?: string;
  filial?: string | null;
  grupo?: string | null;
  linha?: string | null;
  colecao?: string | null;
  subgrupo?: string | null;
  grade?: string | null;
}

export interface StockSummary {
  totalQuantity: number;
  totalValue: number;
}

/**
 * Busca o resumo total de estoque (quantidade e valor)
 * Soma apenas valores de estoque > 0
 * O valor total é calculado como estoque * custo_reposicao1
 */
export async function fetchStockSummary({
  company,
  filial,
  grupo,
  linha,
  colecao,
  subgrupo,
  grade,
}: StockSummaryParams = {}): Promise<StockSummary> {
  return withRequest(async (request) => {
    // Criar filtro de grupo para NERD
    let grupoFilter = '';
    if (company === 'nerd' && grupo) {
      const grupoNormalizado = grupo.trim().toUpperCase();
      request.input('grupo', sql.VarChar, grupoNormalizado);
      grupoFilter = `AND (
        UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupo
      )`;
    }

    // Criar filtros para ScarfMe
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    
    if (company === 'scarfme') {
      if (linha) {
        const linhaNormalizada = linha.trim().toUpperCase();
        request.input('linha', sql.VarChar, linhaNormalizada);
        linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linha`;
      }
      
      if (colecao) {
        const colecaoNormalizada = colecao.trim().toUpperCase();
        request.input('colecao', sql.VarChar, colecaoNormalizada);
        // Como a query começa de ESTOQUE_PRODUTOS, precisamos verificar a coleção na tabela PRODUTOS
        // Mas como é LEFT JOIN, se o produto não existir em PRODUTOS, será NULL
        // Por segurança, verificamos apenas p.COLECAO já que ESTOQUE_PRODUTOS não tem esse campo
        colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao`;
      }
      
      if (subgrupo) {
        const subgrupoNormalizado = subgrupo.trim().toUpperCase();
        request.input('subgrupo', sql.VarChar, subgrupoNormalizado);
        subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
      }
      
      if (grade) {
        const gradeNormalizada = grade.trim().toUpperCase();
        request.input('grade', sql.VarChar, gradeNormalizada);
        gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @grade`;
      }
    }

    // IMPORTANTE: A query deve começar de ESTOQUE_PRODUTOS para garantir que todas as linhas de estoque
    // sejam consideradas, e depois fazer JOIN com PRODUTOS para aplicar os filtros de produto
    // Isso garante que não perdemos nenhuma linha de estoque que corresponda aos filtros
    // Para scarfme, quando não há filial específica (null), considerar TODAS as filiais de inventory
    // (incluindo MATRIZ e MATRIZ CMS - todas as 10 filiais: varejo + ecommerce + matriz)
    const estoqueFilialFilterForWhere = buildFilialFilter(request, company, filial, 'e');
    
    const query = `
      SELECT 
        e.PRODUTO AS productId,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS positiveValue,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS negativeValue
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilterForWhere}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY e.PRODUTO
    `;

    const result = await request.query<{
      productId: string;
      positiveStock: number | null;
      negativeStock: number | null;
      positiveCount: number | null;
      positiveValue: number | null;
      negativeValue: number | null;
    }>(query);

    // DEBUG: Log para entender o que está sendo retornado (sempre, não apenas com coleção)
    const hasProductFilters = !!(colecao || linha || subgrupo || grade || grupo);
    if (hasProductFilters || company === 'scarfme') {
      const filterInfo = [
        colecao && `colecao=${colecao}`,
        linha && `linha=${linha}`,
        subgrupo && `subgrupo=${subgrupo}`,
        grade && `grade=${grade}`,
        grupo && `grupo=${grupo}`
      ].filter(Boolean).join(', ') || 'sem filtros de produto';
      
      console.log(`[fetchStockSummary] ${filterInfo}, Filial: ${filial || 'null'}, Total de produtos retornados: ${result.recordset.length}`);
      let debugTotalPositive = 0;
      let debugTotalNegative = 0;
      let debugProductsWithPositive = 0;
      let debugProductsWithOnlyNegative = 0;
      let debugExcluded = 0;
      let debugFinalFromPositive = 0;
      
      result.recordset.forEach((row) => {
        const pos = Number(row.positiveStock ?? 0);
        const neg = Number(row.negativeStock ?? 0);
        const count = Number(row.positiveCount ?? 0);
        debugTotalPositive += pos;
        debugTotalNegative += neg;
        if (count > 0) {
          debugProductsWithPositive++;
          debugFinalFromPositive += pos;
        } else if (neg < 0) {
          debugProductsWithOnlyNegative++;
        } else {
          debugExcluded++;
        }
      });
      
      console.log(`[fetchStockSummary] DEBUG - Positivo total: ${debugTotalPositive}, Negativo total: ${debugTotalNegative}`);
      console.log(`[fetchStockSummary] DEBUG - Produtos com positivo: ${debugProductsWithPositive}, Apenas negativo: ${debugProductsWithOnlyNegative}, Excluídos: ${debugExcluded}`);
      console.log(`[fetchStockSummary] DEBUG - Final calculado (apenas positivos): ${debugFinalFromPositive}`);
    }

    // Aplicar a mesma lógica usada em fetchMultipleProductsStock
    let totalQuantity = 0;
    let totalValue = 0;

    result.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      const positiveValue = Number(row.positiveValue ?? 0);
      const negativeValue = Number(row.negativeValue ?? 0);
      
      // REGRA: APENAS produtos com estoque POSITIVO devem ser considerados
      // Negativos são IGNORADOS completamente, mesmo que o produto tenha apenas negativo
      // Isso evita valores falsos na soma
      
      // Se o produto não tem estoque positivo em nenhuma filial, IGNORAR completamente
      // (não incluir produtos que só têm negativo)
      if (positiveCount === 0) {
        return; // Ignorar produtos sem estoque positivo
      }
      
      // Se tem positivo em qualquer filial, usar APENAS a soma dos positivos
      // NEGATIVOS são completamente ignorados
      const finalStock = positiveStock;  // Apenas positivos, ignorar negativos
      const finalValue = positiveValue;  // Apenas positivos, ignorar negativos
      
      totalQuantity += finalStock;
      totalValue += finalValue;
    });
    
    // DEBUG: Log do resultado final
    if (hasProductFilters || company === 'scarfme') {
      const filterInfo = [
        colecao && `colecao=${colecao}`,
        linha && `linha=${linha}`,
        subgrupo && `subgrupo=${subgrupo}`,
        grade && `grade=${grade}`,
        grupo && `grupo=${grupo}`
      ].filter(Boolean).join(', ') || 'sem filtros de produto';
      
      console.log(`[fetchStockSummary] ${filterInfo}, Filial: ${filial || 'null'}, Total final calculado: ${totalQuantity}`);
    }

    return {
      totalQuantity,
      totalValue,
    };
  });
}

