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
  ecommerceOnly?: boolean; // Se true e filial é null, buscar apenas filiais de e-commerce
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
  { company, filial, ecommerceOnly = false }: ProductStockParams = {}
): Promise<number> {
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);

    let filialFilter = '';
    if (ecommerceOnly && !filial && company) {
      // Buscar apenas filiais de e-commerce
      const companyConfig = resolveCompany(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filial, index) => {
          request.input(`estoqueEcommerceFilial${index}`, sql.VarChar, filial);
        });
        const placeholders = ecommerceFilials
          .map((_, index) => `@estoqueEcommerceFilial${index}`)
          .join(', ');
        filialFilter = `AND e.FILIAL IN (${placeholders})`;
      }
    } else {
      filialFilter = buildFilialFilter(request, company, filial);
    }

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
  { company, filial, ecommerceOnly = false }: ProductStockParams = {}
): Promise<Map<string, number>> {
  if (productIds.length === 0) {
    return new Map();
  }

  return withRequest(async (request) => {
    let filialFilter = '';
    if (ecommerceOnly && !filial && company) {
      // Buscar apenas filiais de e-commerce
      const companyConfig = resolveCompany(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filial, index) => {
          request.input(`estoqueEcommerceFilial${index}`, sql.VarChar, filial);
        });
        const placeholders = ecommerceFilials
          .map((_, index) => `@estoqueEcommerceFilial${index}`)
          .join(', ');
        filialFilter = `AND e.FILIAL IN (${placeholders})`;
      }
    } else {
      filialFilter = buildFilialFilter(request, company, filial);
    }

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
  grupos?: string[] | null;
  linha?: string | null;
  linhas?: string[] | null;
  colecao?: string | null;
  colecoes?: string[] | null;
  subgrupo?: string | null;
  subgrupos?: string[] | null;
  grade?: string | null;
  grades?: string[] | null;
  ecommerceOnly?: boolean; // Se true e filial é null, buscar apenas filiais de e-commerce
  produtoId?: string;
  produtoSearchTerm?: string;
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
  grupos,
  linha,
  linhas,
  colecao,
  colecoes,
  subgrupo,
  subgrupos,
  grade,
  grades,
  ecommerceOnly = false,
  produtoId,
  produtoSearchTerm,
}: StockSummaryParams = {}): Promise<StockSummary> {
  return withRequest(async (request) => {
    // Criar filtro de grupo para NERD (suporta múltiplos)
    let grupoFilter = '';
    const gruposList = grupos && grupos.length > 0 ? grupos : grupo ? [grupo] : [];
    if (company === 'nerd' && gruposList.length > 0) {
      const gruposNormalizados = gruposList.map(g => g.trim().toUpperCase());
      if (gruposNormalizados.length === 1) {
        request.input('grupo', sql.VarChar, gruposNormalizados[0]);
        grupoFilter = `AND (
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupo
        )`;
      } else {
        gruposNormalizados.forEach((g, index) => {
          request.input(`grupo${index}`, sql.VarChar, g);
        });
        const placeholders = gruposNormalizados.map((_, index) => `@grupo${index}`).join(', ');
        grupoFilter = `AND (
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) IN (${placeholders})
        )`;
      }
    }

    // Criar filtros para ScarfMe (suporta múltiplos)
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    
    if (company === 'scarfme') {
      const linhasList = linhas && linhas.length > 0 ? linhas : linha ? [linha] : [];
      if (linhasList.length > 0) {
        const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
        if (linhasNormalizadas.length === 1) {
          request.input('linha', sql.VarChar, linhasNormalizadas[0]);
          linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linha`;
        } else {
          linhasNormalizadas.forEach((l, index) => {
            request.input(`linha${index}`, sql.VarChar, l);
          });
          const placeholders = linhasNormalizadas.map((_, index) => `@linha${index}`).join(', ');
          linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})`;
        }
      }
      
      const colecoesList = colecoes && colecoes.length > 0 ? colecoes : colecao ? [colecao] : [];
      if (colecoesList.length > 0) {
        const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
        if (colecoesNormalizadas.length === 1) {
          request.input('colecao', sql.VarChar, colecoesNormalizadas[0]);
          colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao`;
        } else {
          colecoesNormalizadas.forEach((c, index) => {
            request.input(`colecao${index}`, sql.VarChar, c);
          });
          const placeholders = colecoesNormalizadas.map((_, index) => `@colecao${index}`).join(', ');
          colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})`;
        }
      }
      
      const subgruposList = subgrupos && subgrupos.length > 0 ? subgrupos : subgrupo ? [subgrupo] : [];
      if (subgruposList.length > 0) {
        const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
        if (subgruposNormalizados.length === 1) {
          request.input('subgrupo', sql.VarChar, subgruposNormalizados[0]);
          subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
        } else {
          subgruposNormalizados.forEach((s, index) => {
            request.input(`subgrupo${index}`, sql.VarChar, s);
          });
          const placeholders = subgruposNormalizados.map((_, index) => `@subgrupo${index}`).join(', ');
          subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})`;
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
    }

    // IMPORTANTE: A query deve começar de ESTOQUE_PRODUTOS para garantir que todas as linhas de estoque
    // sejam consideradas, e depois fazer JOIN com PRODUTOS para aplicar os filtros de produto
    // Isso garante que não perdemos nenhuma linha de estoque que corresponda aos filtros
    // Para scarfme, quando não há filial específica (null), considerar TODAS as filiais de inventory
    // (incluindo MATRIZ e MATRIZ CMS - todas as 10 filiais: varejo + ecommerce + matriz)
    // Se ecommerceOnly é true e filial é null, buscar apenas filiais de e-commerce
    let estoqueFilialFilterForWhere = '';
    if (ecommerceOnly && !filial && company) {
      // Buscar apenas filiais de e-commerce
      const companyConfig = resolveCompany(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filial, index) => {
          request.input(`estoqueEcommerceFilial${index}`, sql.VarChar, filial);
        });
        const placeholders = ecommerceFilials
          .map((_, index) => `@estoqueEcommerceFilial${index}`)
          .join(', ');
        estoqueFilialFilterForWhere = `AND e.FILIAL IN (${placeholders})`;
      }
    } else {
      estoqueFilialFilterForWhere = buildFilialFilter(request, company, filial, 'e');
    }
    
    // Filtro de produto
    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoIdEstoque', sql.VarChar, produtoId);
      produtoFilter = `AND e.PRODUTO = @produtoIdEstoque`;
    } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
      const searchPattern = `%${produtoSearchTerm.trim()}%`;
      request.input('produtoSearchTermEstoque', sql.VarChar, searchPattern);
      produtoFilter = `AND p.DESC_PRODUTO LIKE @produtoSearchTermEstoque`;
    }

    // CORREÇÃO: Quando há QUALQUER filtro de produto (coleção, linha, subgrupo, grade, produtoSearchTerm), usar INNER JOIN
    // para garantir que apenas produtos que existem em PRODUTOS e atendem aos filtros sejam incluídos
    // Isso evita incluir produtos sem os atributos filtrados ou produtos que não existem em PRODUTOS
    const hasProductFilter = !!(colecao || (colecoes && colecoes.length > 0) || 
                                 linha || (linhas && linhas.length > 0) || 
                                 subgrupo || (subgrupos && subgrupos.length > 0) || 
                                 grade || (grades && grades.length > 0) ||
                                 (company === 'nerd' && (grupo || (grupos && grupos.length > 0))) ||
                                 (produtoSearchTerm && produtoSearchTerm.trim().length >= 2));
    const joinType = hasProductFilter ? 'INNER' : 'LEFT';
    
    // DEBUG: Log quando filial é VAREJO ou quando há filtros de produto
    if (filial === VAREJO_VALUE || hasProductFilter) {
      console.log(`[fetchStockSummary] DEBUG - Filtros aplicados:`, {
        filial: filial || 'null',
        filialType: filial === VAREJO_VALUE ? 'VAREJO' : (filial ? 'ESPECIFICA' : 'TODAS'),
        ecommerceOnly,
        hasProductFilter,
        joinType,
        colecao,
        colecoes,
        linha,
        linhas,
        subgrupo,
        subgrupos,
        grade,
        grades,
        grupo,
        grupos,
        estoqueFilialFilterForWhere: estoqueFilialFilterForWhere.length > 100 
          ? estoqueFilialFilterForWhere.substring(0, 100) + '...' 
          : estoqueFilialFilterForWhere,
        grupoFilter: grupoFilter ? grupoFilter.substring(0, 50) + '...' : '',
        linhaFilter: linhaFilter ? linhaFilter.substring(0, 50) + '...' : '',
        colecaoFilter: colecaoFilter ? colecaoFilter.substring(0, 50) + '...' : '',
        subgrupoFilter: subgrupoFilter ? subgrupoFilter.substring(0, 50) + '...' : '',
        gradeFilter: gradeFilter ? gradeFilter.substring(0, 50) + '...' : '',
      });
    }
    
    const query = `
      SELECT 
        e.PRODUTO AS productId,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS positiveValue,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS negativeValue
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilterForWhere}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
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
    
    // DEBUG ESPECÍFICO PARA FILTROS DE PRODUTO
    if (hasProductFilters) {
      console.log(`[fetchStockSummary] DEBUG FILTROS - Filtros aplicados:`, {
        colecao,
        colecoes,
        linha,
        linhas,
        subgrupo,
        subgrupos,
        grade,
        grades,
        grupo,
        grupos,
        joinType,
        ecommerceOnly,
        filial: filial || 'null',
        totalRows: result.recordset.length,
      });
      
      // Verificar se há produtos sem JOIN com PRODUTOS
      const querySemJoin = `
        SELECT 
          COUNT(*) AS total_sem_join,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_sem_join
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          AND p.PRODUTO IS NULL
      `;
      
      const resultSemJoin = await request.query<{
        total_sem_join: number | null;
        estoque_sem_join: number | null;
      }>(querySemJoin);
      
      if (resultSemJoin.recordset.length > 0) {
        const semJoin = resultSemJoin.recordset[0];
        console.log(`[fetchStockSummary] DEBUG FILTROS - Produtos sem JOIN com PRODUTOS:`, {
          total: semJoin.total_sem_join || 0,
          estoque: semJoin.estoque_sem_join || 0,
        });
      }
      
      // Verificar produtos com valores NULL nos campos filtrados
      if (colecao || (colecoes && colecoes.length > 0)) {
        const queryColecaoNull = `
          SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
          WHERE 1=1
            ${estoqueFilialFilterForWhere}
            AND (p.COLECAO IS NULL OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '')
            AND e.ESTOQUE > 0
        `;
        
        const resultColecaoNull = await request.query<{
          total_produtos: number | null;
          estoque_positivo: number | null;
        }>(queryColecaoNull);
        
        if (resultColecaoNull.recordset.length > 0) {
          const colecaoNull = resultColecaoNull.recordset[0];
          console.log(`[fetchStockSummary] DEBUG FILTROS - Produtos com COLECAO NULL ou vazia:`, {
            total: colecaoNull.total_produtos || 0,
            estoque: colecaoNull.estoque_positivo || 0,
          });
        }
      }
      
      // Verificar se o filtro está sendo aplicado corretamente
      const queryComFiltro = `
        SELECT 
          COUNT(DISTINCT e.PRODUTO) AS total_produtos,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          ${colecaoFilter}
          ${linhaFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${grupoFilter}
          ${produtoFilter}
          AND e.ESTOQUE > 0
      `;
      
      const resultComFiltro = await request.query<{
        total_produtos: number | null;
        estoque_positivo: number | null;
      }>(queryComFiltro);
      
      if (resultComFiltro.recordset.length > 0) {
        const comFiltro = resultComFiltro.recordset[0];
        console.log(`[fetchStockSummary] DEBUG FILTROS - Com filtros aplicados:`, {
          total: comFiltro.total_produtos || 0,
          estoque: comFiltro.estoque_positivo || 0,
        });
      }
    }
    
    // DEBUG ESPECÍFICO PARA GRADE (mantido para compatibilidade)
    if (grade || (grades && grades.length > 0)) {
      console.log(`[fetchStockSummary] DEBUG GRADE - Filtro aplicado:`, {
        grade,
        grades,
        gradeFilter,
        ecommerceOnly,
        filial: filial || 'null',
        totalRows: result.recordset.length,
      });
      
      // Verificar se há produtos sem JOIN com PRODUTOS
      const querySemJoin = `
        SELECT 
          COUNT(*) AS total_sem_join,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_sem_join
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          AND p.PRODUTO IS NULL
      `;
      
      const resultSemJoin = await request.query<{
        total_sem_join: number | null;
        estoque_sem_join: number | null;
      }>(querySemJoin);
      
      if (resultSemJoin.recordset.length > 0) {
        const semJoin = resultSemJoin.recordset[0];
        console.log(`[fetchStockSummary] DEBUG GRADE - Produtos sem JOIN com PRODUTOS:`, {
          total: semJoin.total_sem_join || 0,
          estoque: semJoin.estoque_sem_join || 0,
        });
      }
      
      // Verificar produtos com grade NULL que estão sendo incluídos
      const queryGradeNull = `
        SELECT 
          COUNT(DISTINCT e.PRODUTO) AS total_produtos,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          AND (p.GRADE IS NULL OR CONVERT(VARCHAR, p.GRADE) = '')
          AND e.ESTOQUE > 0
      `;
      
      const resultGradeNull = await request.query<{
        total_produtos: number | null;
        estoque_positivo: number | null;
      }>(queryGradeNull);
      
      if (resultGradeNull.recordset.length > 0) {
        const gradeNull = resultGradeNull.recordset[0];
        console.log(`[fetchStockSummary] DEBUG GRADE - Produtos com GRADE NULL:`, {
          total: gradeNull.total_produtos || 0,
          estoque: gradeNull.estoque_positivo || 0,
        });
      }
      
      // Verificar se o filtro está sendo aplicado corretamente
      const queryComFiltro = `
        SELECT 
          COUNT(DISTINCT e.PRODUTO) AS total_produtos,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          ${gradeFilter}
          AND e.ESTOQUE > 0
      `;
      
      const resultComFiltro = await request.query<{
        total_produtos: number | null;
        estoque_positivo: number | null;
      }>(queryComFiltro);
      
      if (resultComFiltro.recordset.length > 0) {
        const comFiltro = resultComFiltro.recordset[0];
        console.log(`[fetchStockSummary] DEBUG GRADE - Com filtro aplicado:`, {
          total: comFiltro.total_produtos || 0,
          estoque: comFiltro.estoque_positivo || 0,
        });
      }
    }
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
    // DIAGNÓSTICO ESPECIAL PARA NERD: Verificar diferença entre planilha e sistema
    if (company === 'nerd' && !filial) {
      // Query para verificar estoque total sem agrupamento (como na planilha)
      const queryTotalSemAgrupamento = `
        SELECT 
          SUM(e.ESTOQUE) AS estoque_total_bruto,
          SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo_total,
          SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_negativo_total,
          COUNT(DISTINCT e.PRODUTO) AS total_produtos,
          COUNT(*) AS total_linhas_estoque
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${produtoFilter}
      `;
      
      const resultTotal = await request.query<{
        estoque_total_bruto: number | null;
        estoque_positivo_total: number | null;
        estoque_negativo_total: number | null;
        total_produtos: number | null;
        total_linhas_estoque: number | null;
      }>(queryTotalSemAgrupamento);
      
      // Query para verificar produtos que só têm estoque negativo (sendo ignorados)
      // Primeiro, vamos construir o filtro de filial para a subquery
      let estoqueFilialFilterForSubquery = estoqueFilialFilterForWhere;
      if (estoqueFilialFilterForSubquery) {
        // Substituir referências de 'e.' por 'e2.' na subquery
        estoqueFilialFilterForSubquery = estoqueFilialFilterForSubquery.replace(/e\.FILIAL/g, 'e2.FILIAL');
      }
      
      const queryApenasNegativo = `
        SELECT 
          COUNT(DISTINCT e.PRODUTO) AS produtos_apenas_negativo,
          SUM(e.ESTOQUE) AS estoque_apenas_negativo_total
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE 1=1
          ${estoqueFilialFilterForWhere}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${produtoFilter}
          AND e.PRODUTO NOT IN (
            SELECT DISTINCT e2.PRODUTO
            FROM ESTOQUE_PRODUTOS e2 WITH (NOLOCK)
            WHERE e2.ESTOQUE > 0
              ${estoqueFilialFilterForSubquery}
          )
          AND e.ESTOQUE < 0
      `;
      
      const resultApenasNegativo = await request.query<{
        produtos_apenas_negativo: number | null;
        estoque_apenas_negativo_total: number | null;
      }>(queryApenasNegativo);
      
      if (resultTotal.recordset.length > 0 && resultApenasNegativo.recordset.length > 0) {
        const total = resultTotal.recordset[0];
        const apenasNegativo = resultApenasNegativo.recordset[0];
        
        const estoqueTotalBruto = Number(total.estoque_total_bruto ?? 0);
        const estoquePositivoTotal = Number(total.estoque_positivo_total ?? 0);
        const estoqueNegativoTotal = Number(total.estoque_negativo_total ?? 0);
        const produtosApenasNegativo = Number(apenasNegativo.produtos_apenas_negativo ?? 0);
        const estoqueApenasNegativo = Number(apenasNegativo.estoque_apenas_negativo_total ?? 0);
        
        console.log(`[fetchStockSummary] DIAGNÓSTICO NERD - Análise de estoque:`, {
          estoque_sistema_atual: totalQuantity,
          estoque_total_bruto: estoqueTotalBruto,
          estoque_positivo_total: estoquePositivoTotal,
          estoque_negativo_total: estoqueNegativoTotal,
          produtos_apenas_negativo: produtosApenasNegativo,
          estoque_apenas_negativo: estoqueApenasNegativo,
          diferenca_bruto_vs_sistema: estoqueTotalBruto - totalQuantity,
          diferenca_positivo_vs_sistema: estoquePositivoTotal - totalQuantity,
          total_produtos: total.total_produtos || 0,
          total_linhas_estoque: total.total_linhas_estoque || 0,
        });
      }
    }
    
    if (hasProductFilters || company === 'scarfme' || filial === VAREJO_VALUE) {
      const filterInfo = [
        colecao && `colecao=${colecao}`,
        linha && `linha=${linha}`,
        subgrupo && `subgrupo=${subgrupo}`,
        grade && `grade=${grade}`,
        grupo && `grupo=${grupo}`
      ].filter(Boolean).join(', ') || 'sem filtros de produto';
      
      console.log(`[fetchStockSummary] ${filterInfo}, Filial: ${filial || 'null'}, Total de linhas retornadas: ${result.recordset.length}, Total final calculado: ${totalQuantity}`);
      
      // DEBUG ESPECÍFICO PARA VAREJO: Verificar se há produtos duplicados ou problemas de agregação
      if (filial === VAREJO_VALUE) {
        // Verificar se há produtos que aparecem em múltiplas filiais
        const queryVerificarDuplicados = `
          SELECT 
            COUNT(DISTINCT e.PRODUTO) AS produtos_distintos,
            COUNT(*) AS total_linhas_estoque,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_total_sem_group
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          ${joinType} JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
          WHERE 1=1
            ${estoqueFilialFilterForWhere}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${produtoFilter}
            AND e.ESTOQUE > 0
        `;
        
        const resultVerificar = await request.query<{
          produtos_distintos: number | null;
          total_linhas_estoque: number | null;
          estoque_total_sem_group: number | null;
        }>(queryVerificarDuplicados);
        
        if (resultVerificar.recordset.length > 0) {
          const verificar = resultVerificar.recordset[0];
          console.log(`[fetchStockSummary] DEBUG VAREJO - Verificacao de agregacao:`, {
            produtos_distintos: verificar.produtos_distintos || 0,
            total_linhas_estoque: verificar.total_linhas_estoque || 0,
            estoque_total_sem_group: verificar.estoque_total_sem_group || 0,
            estoque_total_com_group: totalQuantity,
            diferenca: (verificar.estoque_total_sem_group || 0) - totalQuantity,
          });
        }
      }
    }

    return {
      totalQuantity,
      totalValue,
    };
  });
}

