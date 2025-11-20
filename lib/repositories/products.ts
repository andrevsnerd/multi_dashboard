import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { fetchMultipleProductsStock } from '@/lib/repositories/inventory';
import {
  fetchTopProductsEcommerce,
} from '@/lib/repositories/ecommerce';
import { getColorDescription } from '@/lib/utils/colorMapping';

export interface ProductDetail {
  productId: string;
  productName: string;
  totalRevenue: number;
  totalQuantity: number;
  averagePrice: number;
  cost: number;
  markup: number;
  stock: number;
  revenueVariance: number | null; // null se for novo produto
  quantityVariance: number | null; // null se for novo produto
  isNew: boolean; // true se não teve vendas no período anterior
  corProduto?: string | null; // Código da cor do produto
  descCorProduto?: string | null; // Descrição da cor do produto
}

export interface ProductsQueryParams {
  company?: string;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
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
  groupByColor?: boolean; // Se true, agrupa produtos por cor
}

function resolveRange(range?: { start?: string | Date; end?: string | Date }) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
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

/**
 * Cria filtro de grupo para NERD (suporta múltiplos valores)
 */
function buildGrupoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grupo: string | null | undefined,
  grupos: string[] | null | undefined
): string {
  if (companySlug !== 'nerd') {
    return '';
  }
  
  // Usar array se fornecido, senão usar valor único (compatibilidade)
  const gruposList = grupos && grupos.length > 0 
    ? grupos 
    : grupo 
      ? [grupo] 
      : [];
  
  if (gruposList.length === 0) {
    return '';
  }
  
  // Normalizar grupos
  const gruposNormalizados = gruposList.map(g => g.trim().toUpperCase());
  
  if (gruposNormalizados.length === 1) {
    request.input('grupo', sql.VarChar, gruposNormalizados[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) = @grupo
      OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupo
    )`;
  }
  
  // Múltiplos grupos - usar IN
  gruposNormalizados.forEach((g, index) => {
    request.input(`grupo${index}`, sql.VarChar, g);
  });
  
  const placeholders = gruposNormalizados
    .map((_, index) => `@grupo${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de linha para ScarfMe (suporta múltiplos valores)
 */
function buildLinhaFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  linha: string | null | undefined,
  linhas: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const linhasList = linhas && linhas.length > 0 
    ? linhas 
    : linha 
      ? [linha] 
      : [];
  
  if (linhasList.length === 0) {
    return '';
  }
  
  const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
  
  if (linhasNormalizadas.length === 1) {
    request.input('linha', sql.VarChar, linhasNormalizadas[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) = @linha
      OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linha
    )`;
  }
  
  linhasNormalizadas.forEach((l, index) => {
    request.input(`linha${index}`, sql.VarChar, l);
  });
  
  const placeholders = linhasNormalizadas
    .map((_, index) => `@linha${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de coleção para ScarfMe (suporta múltiplos valores)
 */
function buildColecaoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  colecao: string | null | undefined,
  colecoes: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const colecoesList = colecoes && colecoes.length > 0 
    ? colecoes 
    : colecao 
      ? [colecao] 
      : [];
  
  if (colecoesList.length === 0) {
    return '';
  }
  
  const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
  
  if (colecoesNormalizadas.length === 1) {
    request.input('colecao', sql.VarChar, colecoesNormalizadas[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) = @colecao
      OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao
    )`;
  }
  
  colecoesNormalizadas.forEach((c, index) => {
    request.input(`colecao${index}`, sql.VarChar, c);
  });
  
  const placeholders = colecoesNormalizadas
    .map((_, index) => `@colecao${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de subgrupo para ScarfMe (suporta múltiplos valores)
 */
function buildSubgrupoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  subgrupo: string | null | undefined,
  subgrupos: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const subgruposList = subgrupos && subgrupos.length > 0 
    ? subgrupos 
    : subgrupo 
      ? [subgrupo] 
      : [];
  
  if (subgruposList.length === 0) {
    return '';
  }
  
  const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
  
  if (subgruposNormalizados.length === 1) {
    request.input('subgrupo', sql.VarChar, subgruposNormalizados[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) = @subgrupo
      OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo
    )`;
  }
  
  subgruposNormalizados.forEach((s, index) => {
    request.input(`subgrupo${index}`, sql.VarChar, s);
  });
  
  const placeholders = subgruposNormalizados
    .map((_, index) => `@subgrupo${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de grade para ScarfMe (suporta múltiplos valores)
 */
function buildGradeFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grade: string | null | undefined,
  grades: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const gradesList = grades && grades.length > 0 
    ? grades 
    : grade 
      ? [grade] 
      : [];
  
  if (gradesList.length === 0) {
    return '';
  }
  
  const gradesNormalizadas = gradesList.map(g => g.trim().toUpperCase());
  
  if (gradesNormalizadas.length === 1) {
    request.input('grade', sql.VarChar, gradesNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @grade`;
  }
  
  gradesNormalizadas.forEach((g, index) => {
    request.input(`grade${index}`, sql.VarChar, g);
  });
  
  const placeholders = gradesNormalizadas
    .map((_, index) => `@grade${index}`)
    .join(', ');
  
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) IN (${placeholders})`;
}

/**
 * Busca produtos com todas as informações necessárias para a página de produtos
 * Inclui faturamento, quantidade, preço médio, custo, markup, estoque e variações
 */
export async function fetchProductsWithDetails({
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
  groupByColor = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchProductsWithDetailsEcommerce({ company, range, filial, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (company === 'scarfme' && filial === null) {
    const [salesProducts, ecommerceProducts] = await Promise.all([
      fetchProductsWithDetailsSales({ company, range, filial: VAREJO_VALUE, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor }),
      fetchProductsWithDetailsEcommerce({ company, range, filial: null, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor }),
    ]);

    // Agregar produtos por productId (e cor se groupByColor estiver ativo)
    const productMap = new Map<string, ProductDetail>();
    const getKey = (product: ProductDetail) => 
      groupByColor && product.corProduto 
        ? `${product.productId}-${product.corProduto}` 
        : product.productId;

    // Adicionar produtos de vendas normais
    salesProducts.forEach((product) => {
      const key = getKey(product);
      productMap.set(key, { ...product });
    });

    // Agregar produtos de ecommerce
    ecommerceProducts.forEach((product) => {
      const key = getKey(product);
      const existing = productMap.get(key);
      if (existing) {
        existing.totalRevenue += product.totalRevenue;
        existing.totalQuantity += product.totalQuantity;
        existing.averagePrice = existing.totalRevenue / existing.totalQuantity;
        // Manter o custo e estoque da venda normal (já foi buscado)
        if (existing.cost > 0) {
          existing.markup = existing.averagePrice / existing.cost;
        }
      } else {
        productMap.set(key, { ...product });
      }
    });

    // Converter para array e ordenar por revenue
    return Array.from(productMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  // Função normal para vendas de loja
  return fetchProductsWithDetailsSales({ company, range, filial, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor });
}

/**
 * Busca produtos com detalhes para vendas normais (não e-commerce)
 */
async function fetchProductsWithDetailsSales({
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
  groupByColor = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Calcular período anterior para comparação
    const previousRange = shiftRangeByMonths({ start, end }, -1);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial);
    const grupoFilter = buildGrupoFilterForProducts(request, company, grupo, grupos);
    const linhaFilter = buildLinhaFilterForProducts(request, company, linha, linhas);
    const colecaoFilter = buildColecaoFilterForProducts(request, company, colecao, colecoes);
    const subgrupoFilter = buildSubgrupoFilterForProducts(request, company, subgrupo, subgrupos);
    const gradeFilter = buildGradeFilterForProducts(request, company, grade, grades);

    // Definir campos de agrupamento e seleção baseado em groupByColor
    const groupByFields = groupByColor 
      ? 'vp.PRODUTO, vp.COR_PRODUTO'
      : 'vp.PRODUTO';
    
    const colorSelectFields = groupByColor
      ? `vp.COR_PRODUTO AS corProduto,
         MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS descCorProduto,`
      : '';

    // Query para período atual
    const currentQuery = `
      SELECT 
        vp.PRODUTO AS productId,
        MAX(vp.DESC_PRODUTO) AS productName,
        MAX(COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')) AS grupo,
        ${colorSelectFields}
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue,
        SUM(vp.QTDE) AS totalQuantity,
        AVG(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN NULL
            ELSE vp.CUSTO
          END
        ) AS cost
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      ${groupByColor ? 'LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR' : ''}
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${groupByFields}
    `;

    // Query para período anterior
    const previousColorSelectFields = groupByColor
      ? 'vp.COR_PRODUTO AS corProduto,'
      : '';

    const previousQuery = `
      SELECT 
        vp.PRODUTO AS productId,
        ${previousColorSelectFields}
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS previousRevenue,
        SUM(vp.QTDE) AS previousQuantity
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @previousStartDate
        AND vp.DATA_VENDA < @previousEndDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${groupByFields}
    `;

    // Query para verificar se o produto já teve vendas em algum momento antes do período atual
    const hasEverSoldColorSelectFields = groupByColor
      ? 'vp.COR_PRODUTO AS corProduto,'
      : '';

    const hasEverSoldQuery = `
      SELECT 
        vp.PRODUTO AS productId,
        ${hasEverSoldColorSelectFields}
        COUNT(*) AS saleCount
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA < @startDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${groupByFields}
    `;

    const [currentResult, previousResult, hasEverSoldResult] = await Promise.all([
      request.query<{
        productId: string;
        productName: string;
        grupo: string | null;
        corProduto?: string | null;
        descCorProduto?: string | null;
        totalRevenue: number | null;
        totalQuantity: number | null;
        cost: number | null;
      }>(currentQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        previousRevenue: number | null;
        previousQuantity: number | null;
      }>(previousQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        saleCount: number;
      }>(hasEverSoldQuery),
    ]);

    // Criar mapa do período anterior (chave inclui cor se groupByColor estiver ativo)
    const previousMap = new Map<string, { revenue: number; quantity: number }>();
    previousResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      previousMap.set(key, {
        revenue: Number(row.previousRevenue ?? 0),
        quantity: Number(row.previousQuantity ?? 0),
      });
    });

    // Criar mapa de produtos que já tiveram vendas antes do período atual
    const hasEverSoldMap = new Map<string, boolean>();
    hasEverSoldResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      hasEverSoldMap.set(key, true);
    });

    const products = currentResult.recordset.map((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const cost = Number(row.cost ?? 0);
      const grupo = (row.grupo && row.grupo.trim() !== '') ? row.grupo.trim() : null;
      
      // Obter chave para buscar dados do período anterior (inclui cor se groupByColor estiver ativo)
      const previousKey = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      const previous = previousMap.get(previousKey) ?? { revenue: 0, quantity: 0 };
      const previousRevenue = previous.revenue;
      const previousQuantity = previous.quantity;
      
      // Verificar se o produto já teve vendas em algum momento antes do período atual
      const hasEverSold = hasEverSoldMap.has(previousKey);
      
      const averagePrice = quantity > 0 ? revenue / quantity : 0;
      const markup = cost > 0 ? averagePrice / cost : 0;
      
      // Calcular variações
      // isNew só é true se não teve vendas no período anterior E nunca teve vendas antes
      const isNew = previousRevenue === 0 && previousQuantity === 0 && !hasEverSold;
      
      // Se não teve vendas no período anterior mas já teve antes, mostrar 0% em vez de null
      const revenueVariance = isNew
        ? null
        : previousRevenue === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));
      const quantityVariance = isNew
        ? null
        : previousQuantity === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((quantity - previousQuantity) / previousQuantity) * 100).toFixed(1));

      // Processar informações de cor
      const corProduto = groupByColor ? (row.corProduto || null) : null;
      const descCorProduto = groupByColor 
        ? getColorDescription(row.corProduto, row.descCorProduto)
        : null;

      return {
        productId: row.productId,
        productName: row.productName || 'Sem descrição',
        totalRevenue: revenue,
        totalQuantity: quantity,
        averagePrice,
        cost,
        markup,
        stock: 0, // Será preenchido abaixo
        revenueVariance,
        quantityVariance,
        isNew,
        corProduto,
        descCorProduto,
      };
    });

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

    return products.sort((a, b) => b.totalRevenue - a.totalRevenue);
  });
}

/**
 * Busca produtos com detalhes para e-commerce
 */
async function fetchProductsWithDetailsEcommerce({
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
  groupByColor = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Calcular período anterior para comparação
    const previousRange = shiftRangeByMonths({ start, end }, -1);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    // Construir filtro de filial para e-commerce
    let filialFilter = '';
    if (company) {
      const companyConfig = resolveCompany(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      
      if (filial && filial !== VAREJO_VALUE) {
        request.input('filial', sql.VarChar, filial);
        filialFilter = `AND f.FILIAL = @filial`;
      } else if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filial, index) => {
          request.input(`filial${index}`, sql.VarChar, filial);
        });
        const placeholders = ecommerceFilials
          .map((_, index) => `@filial${index}`)
          .join(', ');
        filialFilter = `AND f.FILIAL IN (${placeholders})`;
      }
    }

    // Para e-commerce, construir filtros usando apenas p (não temos vp)
    // Criar filtros específicos para e-commerce para evitar problemas com substituição de strings
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    
    // Filtro de linha para e-commerce
    const linhasList = linhas && linhas.length > 0 ? linhas : linha ? [linha] : [];
    if (company === 'scarfme' && linhasList.length > 0) {
      const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
      if (linhasNormalizadas.length === 1) {
        request.input('linhaEcommerce', sql.VarChar, linhasNormalizadas[0]);
        linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaEcommerce`;
      } else {
        linhasNormalizadas.forEach((l, index) => {
          request.input(`linhaEcommerce${index}`, sql.VarChar, l);
        });
        const placeholders = linhasNormalizadas.map((_, index) => `@linhaEcommerce${index}`).join(', ');
        linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de coleção para e-commerce
    const colecoesList = colecoes && colecoes.length > 0 ? colecoes : colecao ? [colecao] : [];
    if (company === 'scarfme' && colecoesList.length > 0) {
      const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
      if (colecoesNormalizadas.length === 1) {
        request.input('colecaoEcommerce', sql.VarChar, colecoesNormalizadas[0]);
        colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecaoEcommerce`;
      } else {
        colecoesNormalizadas.forEach((c, index) => {
          request.input(`colecaoEcommerce${index}`, sql.VarChar, c);
        });
        const placeholders = colecoesNormalizadas.map((_, index) => `@colecaoEcommerce${index}`).join(', ');
        colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de subgrupo para e-commerce
    const subgruposList = subgrupos && subgrupos.length > 0 ? subgrupos : subgrupo ? [subgrupo] : [];
    if (company === 'scarfme' && subgruposList.length > 0) {
      const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
      if (subgruposNormalizados.length === 1) {
        request.input('subgrupoEcommerce', sql.VarChar, subgruposNormalizados[0]);
        subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupoEcommerce`;
      } else {
        subgruposNormalizados.forEach((s, index) => {
          request.input(`subgrupoEcommerce${index}`, sql.VarChar, s);
        });
        const placeholders = subgruposNormalizados.map((_, index) => `@subgrupoEcommerce${index}`).join(', ');
        subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de grade para e-commerce
    const gradesList = grades && grades.length > 0 ? grades : grade ? [grade] : [];
    if (company === 'scarfme' && gradesList.length > 0) {
      const gradesNormalizadas = gradesList.map(g => g.trim().toUpperCase());
      if (gradesNormalizadas.length === 1) {
        request.input('gradeEcommerce', sql.VarChar, gradesNormalizadas[0]);
        gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @gradeEcommerce`;
      } else {
        gradesNormalizadas.forEach((g, index) => {
          request.input(`gradeEcommerce${index}`, sql.VarChar, g);
        });
        const placeholders = gradesNormalizadas.map((_, index) => `@gradeEcommerce${index}`).join(', ');
        gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) IN (${placeholders})`;
      }
    }

    // Definir campos de agrupamento e seleção baseado em groupByColor
    const ecommerceGroupByFields = groupByColor 
      ? 'fp.PRODUTO, fp.COR_PRODUTO'
      : 'fp.PRODUTO';
    
    const ecommerceColorSelectFields = groupByColor
      ? `fp.COR_PRODUTO AS corProduto,`
      : '';

    // Query para período atual
    const currentQuery = `
      SELECT 
        fp.PRODUTO AS productId,
        MAX(p.DESC_PRODUTO) AS productName,
        ${ecommerceColorSelectFields}
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity,
        AVG(ISNULL(fp.CUSTO_NA_DATA, 0)) AS cost
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${ecommerceGroupByFields}
    `;

    // Query para período anterior
    const previousEcommerceColorSelectFields = groupByColor
      ? 'fp.COR_PRODUTO AS corProduto,'
      : '';

    const previousQuery = `
      SELECT 
        fp.PRODUTO AS productId,
        ${previousEcommerceColorSelectFields}
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS previousRevenue,
        SUM(fp.QTDE) AS previousQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @previousStartDate
        AND f.EMISSAO < @previousEndDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${ecommerceGroupByFields}
    `;

    // Query para verificar se o produto já teve vendas em algum momento antes do período atual (e-commerce)
    const hasEverSoldEcommerceColorSelectFields = groupByColor
      ? 'fp.COR_PRODUTO AS corProduto,'
      : '';

    const hasEverSoldEcommerceQuery = `
      SELECT 
        fp.PRODUTO AS productId,
        ${hasEverSoldEcommerceColorSelectFields}
        COUNT(*) AS saleCount
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO < @startDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${ecommerceGroupByFields}
    `;

    const [currentResult, previousResult, hasEverSoldResult] = await Promise.all([
      request.query<{
        productId: string;
        productName: string;
        corProduto?: string | null;
        totalRevenue: number | null;
        totalQuantity: number | null;
        cost: number | null;
      }>(currentQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        previousRevenue: number | null;
        previousQuantity: number | null;
      }>(previousQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        saleCount: number;
      }>(hasEverSoldEcommerceQuery),
    ]);

    // Criar mapa do período anterior (chave inclui cor se groupByColor estiver ativo)
    const previousMap = new Map<string, { revenue: number; quantity: number }>();
    previousResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      previousMap.set(key, {
        revenue: Number(row.previousRevenue ?? 0),
        quantity: Number(row.previousQuantity ?? 0),
      });
    });

    // Criar mapa de produtos que já tiveram vendas antes do período atual (e-commerce)
    const hasEverSoldMap = new Map<string, boolean>();
    hasEverSoldResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      hasEverSoldMap.set(key, true);
    });

    const products = currentResult.recordset.map((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const cost = Number(row.cost ?? 0);
      
      // Obter chave para buscar dados do período anterior (inclui cor se groupByColor estiver ativo)
      const previousKey = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      const previous = previousMap.get(previousKey) ?? { revenue: 0, quantity: 0 };
      const previousRevenue = previous.revenue;
      const previousQuantity = previous.quantity;
      
      // Verificar se o produto já teve vendas em algum momento antes do período atual
      const hasEverSold = hasEverSoldMap.has(previousKey);
      
      const averagePrice = quantity > 0 ? revenue / quantity : 0;
      const markup = cost > 0 ? averagePrice / cost : 0;
      
      // Calcular variações
      // isNew só é true se não teve vendas no período anterior E nunca teve vendas antes
      const isNew = previousRevenue === 0 && previousQuantity === 0 && !hasEverSold;
      
      // Se não teve vendas no período anterior mas já teve antes, mostrar 0% em vez de null
      const revenueVariance = isNew
        ? null
        : previousRevenue === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));
      const quantityVariance = isNew
        ? null
        : previousQuantity === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((quantity - previousQuantity) / previousQuantity) * 100).toFixed(1));

      // Processar informações de cor
      const corProduto = groupByColor ? (row.corProduto || null) : null;
      const descCorProduto = groupByColor 
        ? getColorDescription(row.corProduto, null)
        : null;

      return {
        productId: row.productId,
        productName: row.productName || 'Sem descrição',
        totalRevenue: revenue,
        totalQuantity: quantity,
        averagePrice,
        cost,
        markup,
        stock: 0, // Será preenchido abaixo
        revenueVariance,
        quantityVariance,
        isNew,
        corProduto,
        descCorProduto,
      };
    });

    // Buscar estoque para todos os produtos de uma vez
    // IMPORTANTE: Para e-commerce, quando filial é null, buscar estoque apenas das filiais de e-commerce
    if (products.length > 0) {
      const productIds = products.map((p) => p.productId);
      const stockMap = await fetchMultipleProductsStock(productIds, {
        company,
        filial,
        ecommerceOnly: !filial, // Se filial é null, buscar apenas filiais de e-commerce
      });

      // Adicionar estoque a cada produto
      products.forEach((product) => {
        product.stock = stockMap.get(product.productId) ?? 0;
      });
    }

    return products.sort((a, b) => b.totalRevenue - a.totalRevenue);
  });
}

/**
 * Busca grupos disponíveis para NERD
 * Busca apenas grupos de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableGrupos({
  company,
  range,
  filial,
}: Omit<ProductsQueryParams, 'grupo'> = {}): Promise<string[]> {
  if (company !== 'nerd') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '') AS grupo
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '') <> ''
        ${filialFilter}
      ORDER BY grupo
    `;

    try {
      const result = await request.query<{ grupo: string }>(query);
      const grupos = result.recordset
        .map((row) => {
          const grupo = row.grupo?.trim() || '';
          return grupo.toUpperCase();
        })
        .filter((grupo) => grupo !== '');
      
      // Remover duplicatas após normalização
      const gruposUnicos = [...new Set(grupos)].sort();
      
      return gruposUnicos;
    } catch (error) {
      console.error('Erro ao buscar grupos:', error);
      return [];
    }
  });
}

/**
 * Busca linhas disponíveis para ScarfMe
 * Busca apenas linhas de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableLinhas({
  company,
  range,
  filial,
}: Omit<ProductsQueryParams, 'linha'> = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.LINHA, p.LINHA, '') AS linha
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.LINHA, p.LINHA, '') <> ''
        ${filialFilter}
      ORDER BY linha
    `;

    try {
      const result = await request.query<{ linha: string }>(query);
      const linhas = result.recordset
        .map((row) => {
          const linha = row.linha?.trim() || '';
          return linha.toUpperCase();
        })
        .filter((linha) => linha !== '');
      
      const linhasUnicas = [...new Set(linhas)].sort();
      
      return linhasUnicas;
    } catch (error) {
      console.error('Erro ao buscar linhas:', error);
      return [];
    }
  });
}

/**
 * Busca coleções disponíveis para ScarfMe
 * Busca apenas coleções de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableColecoes({
  company,
  range,
  filial,
}: Omit<ProductsQueryParams, 'colecao'> = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.COLECAO, p.COLECAO, '') AS colecao
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.COLECAO, p.COLECAO, '') <> ''
        ${filialFilter}
      ORDER BY colecao
    `;

    try {
      const result = await request.query<{ colecao: string }>(query);
      const colecoes = result.recordset
        .map((row) => {
          const colecao = row.colecao?.trim() || '';
          return colecao.toUpperCase();
        })
        .filter((colecao) => colecao !== '');
      
      const colecoesUnicas = [...new Set(colecoes)].sort();
      
      return colecoesUnicas;
    } catch (error) {
      console.error('Erro ao buscar coleções:', error);
      return [];
    }
  });
}

/**
 * Busca subgrupos disponíveis para ScarfMe
 * Busca apenas subgrupos de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableSubgrupos({
  company,
  range,
  filial,
}: Omit<ProductsQueryParams, 'subgrupo'> = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '') AS subgrupo
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '') <> ''
        ${filialFilter}
      ORDER BY subgrupo
    `;

    try {
      const result = await request.query<{ subgrupo: string }>(query);
      const subgrupos = result.recordset
        .map((row) => {
          const subgrupo = row.subgrupo?.trim() || '';
          return subgrupo.toUpperCase();
        })
        .filter((subgrupo) => subgrupo !== '');
      
      const subgruposUnicos = [...new Set(subgrupos)].sort();
      
      return subgruposUnicos;
    } catch (error) {
      console.error('Erro ao buscar subgrupos:', error);
      return [];
    }
  });
}

/**
 * Busca grades disponíveis para ScarfMe
 * Busca apenas grades de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableGrades({
  company,
  range,
  filial,
}: Omit<ProductsQueryParams, 'grade'> = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT DISTINCT 
        UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS grade
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND p.GRADE IS NOT NULL
        ${filialFilter}
      ORDER BY grade
    `;

    try {
      const result = await request.query<{ grade: string }>(query);
      const grades = result.recordset
        .map((row) => {
          const grade = row.grade?.trim() || '';
          return grade.toUpperCase();
        })
        .filter((grade) => grade !== '');
      
      const gradesUnicas = [...new Set(grades)].sort();
      
      return gradesUnicas;
    } catch (error) {
      console.error('Erro ao buscar grades:', error);
      return [];
    }
  });
}
