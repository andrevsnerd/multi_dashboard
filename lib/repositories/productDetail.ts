import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { getColorDescription } from '@/lib/utils/colorMapping';

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

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp',
  paramPrefix: string = 'filial'
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
    request.input(paramPrefix, sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @${paramPrefix}`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@${paramPrefix}${index}`)
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
      request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@${paramPrefix}${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@${paramPrefix}${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

export interface ProductDetailInfo {
  productId: string;
  productName: string;
  lastEntryDate: Date | null;
  lastEntryFilial: string | null;
  totalRevenue: number;
  totalQuantity: number;
  totalStock: number;
  totalMarkup: number;
  averagePrice: number;
  averageCost: number;
  topFilial: string | null;
  topFilialDisplayName: string | null;
  topFilialRevenue: number;
  topColor: string | null;
  topColorCode: string | null;
  topColorDisplayName: string | null;
  topColorQuantity: number;
  topColorMarkup: number;
  revenueVariance: number | null;
}

export interface ProductStockByFilial {
  filial: string;
  filialDisplayName: string;
  stock: number;
  revenue: number;
  quantity: number;
  revenueVariance: number | null;
}

export interface ProductSaleHistory {
  date: Date;
  filial: string;
  filialDisplayName: string;
  quantity: number;
  revenue: number;
  color: string | null;
  colorDisplayName: string | null;
}

export interface ProductDetailParams {
  productId: string;
  company?: string;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
  filial?: string | null;
}

function resolveRange(range?: { start?: string | Date; end?: string | Date }) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

/**
 * Busca dados de ecommerce de um produto específico
 */
async function fetchProductDetailEcommerce({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<{
  totalRevenue: number;
  totalQuantity: number;
  previousRevenue: number;
  revenueByFilial: Map<string, number>;
  quantityByFilial: Map<string, number>;
  quantityByColor: Map<string, number>;
  revenueByColor: Map<string, number>;
}> {
  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const filialFilter = buildEcommerceFilialFilter(request, company, filial, 'f');

    // Buscar vendas do período atual
    const currentSalesQuery = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity,
        f.FILIAL,
        fp.COR_PRODUTO
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      GROUP BY f.FILIAL, fp.COR_PRODUTO
    `;

    // Buscar vendas do período anterior
    const previousSalesQuery = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@previousStartDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@previousEndDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      GROUP BY f.FILIAL
    `;

    const [currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        FILIAL: string;
        COR_PRODUTO: string | null;
      }>(currentSalesQuery),
      request.query<{
        totalRevenue: number | null;
        FILIAL: string;
      }>(previousSalesQuery),
    ]);

    let totalRevenue = 0;
    let totalQuantity = 0;
    let previousRevenue = 0;
    const revenueByFilial = new Map<string, number>();
    const quantityByFilial = new Map<string, number>();
    const quantityByColor = new Map<string, number>();
    const revenueByColor = new Map<string, number>();

    currentSalesResult.recordset.forEach((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const filial = (row.FILIAL || '').trim();
      const cor = row.COR_PRODUTO || 'SEM COR';

      totalRevenue += revenue;
      totalQuantity += quantity;

      revenueByFilial.set(filial, (revenueByFilial.get(filial) ?? 0) + revenue);
      quantityByFilial.set(filial, (quantityByFilial.get(filial) ?? 0) + quantity);
      quantityByColor.set(cor, (quantityByColor.get(cor) ?? 0) + quantity);
      revenueByColor.set(cor, (revenueByColor.get(cor) ?? 0) + revenue);
    });

    previousSalesResult.recordset.forEach((row) => {
      previousRevenue += Number(row.totalRevenue ?? 0);
    });

    return {
      totalRevenue,
      totalQuantity,
      previousRevenue,
      revenueByFilial,
      quantityByFilial,
      quantityByColor,
      revenueByColor,
    };
  });
}

/**
 * Busca dados detalhados de um produto específico
 */
export async function fetchProductDetail({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductDetailInfo> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductDetail({ productId, company, range, filial: VAREJO_VALUE }),
      fetchProductDetailEcommerce({ productId, company, range, filial: null }),
    ]);

    // Calcular previousRevenue do salesResult
    const salesPreviousRevenue = salesResult.revenueVariance !== null && salesResult.totalRevenue > 0
      ? salesResult.totalRevenue / (1 + salesResult.revenueVariance / 100)
      : 0;

    // Agregar dados
    const totalRevenue = salesResult.totalRevenue + ecommerceResult.totalRevenue;
    const totalQuantity = salesResult.totalQuantity + ecommerceResult.totalQuantity;
    const previousRevenue = salesPreviousRevenue + ecommerceResult.previousRevenue;

    // Agregar revenue por filial para encontrar topFilial
    const allRevenueByFilial = new Map(salesResult.topFilial ? [[salesResult.topFilial, salesResult.topFilialRevenue]] : []);
    ecommerceResult.revenueByFilial.forEach((revenue, filialName) => {
      allRevenueByFilial.set(filialName, (allRevenueByFilial.get(filialName) ?? 0) + revenue);
    });

    // Encontrar topFilial
    let topFilial: string | null = null;
    let topFilialDisplayName: string | null = null;
    let topFilialRevenue = 0;
    const companyConfig = resolveCompany(company);
    const displayNames = companyConfig?.filialDisplayNames ?? {};
    allRevenueByFilial.forEach((revenue, filialName) => {
      if (revenue > topFilialRevenue) {
        topFilialRevenue = revenue;
        topFilial = filialName;
        // Normalizar o nome da filial (trim) e aplicar mapeamento
        const normalizedFilial = filialName.trim();
        topFilialDisplayName = displayNames[normalizedFilial] ?? displayNames[filialName] ?? filialName;
      }
    });

    // Agregar quantity por cor
    const allQuantityByColor = new Map<string, number>();
    // Adicionar cores do salesResult (precisamos buscar isso de outra forma ou usar uma aproximação)
    // Por enquanto, vamos manter o topColor do salesResult, mas podemos melhorar isso depois

    const revenueVariance =
      previousRevenue === 0
        ? (totalRevenue > 0 ? null : 0)
        : Number((((totalRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

    // Recalcular média e markup
    const averageCost = salesResult.averageCost; // Usar o mesmo custo (ecommerce não tem custo detalhado)
    const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
    const totalMarkup = averageCost > 0 ? averagePrice / averageCost : 0;

    return {
      ...salesResult,
      totalRevenue,
      totalQuantity,
      totalMarkup,
      averagePrice,
      topFilial,
      topFilialDisplayName,
      topFilialRevenue,
      revenueVariance,
    };
  }

  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    // Buscar dados básicos do produto e última entrada
    const productQuery = `
      SELECT TOP 1
        p.PRODUTO AS productId,
        p.DESC_PRODUTO AS productName,
        (
          SELECT TOP 1
            E.EMISSAO
          FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_ENT AS P1 WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P1.ROMANEIO_PRODUTO
          WHERE P1.PRODUTO = @productId
          ORDER BY E.EMISSAO DESC
        ) AS lastEntryDate,
        (
          SELECT TOP 1
            E.FILIAL
          FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_ENT AS P1 WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P1.ROMANEIO_PRODUTO
          WHERE P1.PRODUTO = @productId
          ORDER BY E.EMISSAO DESC
        ) AS lastEntryFilial
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE p.PRODUTO = @productId
    `;

    const productResult = await request.query<{
      productId: string;
      productName: string | null;
      lastEntryDate: Date | null;
      lastEntryFilial: string | null;
    }>(productQuery);

    const productRow = productResult.recordset[0] ?? {
      productId,
      productName: null,
      lastEntryDate: null,
      lastEntryFilial: null,
    };

    const companyConfig = resolveCompany(company);
    const displayNames = companyConfig?.filialDisplayNames ?? {};

    // Buscar vendas do período atual
    const currentSalesQuery = `
      SELECT 
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue,
        SUM(vp.QTDE) AS totalQuantity,
        vp.FILIAL,
        vp.COR_PRODUTO,
        ISNULL(c.DESC_COR, '') AS corBanco,
        AVG(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN NULL
            ELSE vp.CUSTO
          END
        ) AS cost
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.PRODUTO = @productId
        AND vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY vp.FILIAL, vp.COR_PRODUTO, c.DESC_COR
    `;

    // Buscar vendas do período anterior
    const previousSalesQuery = `
      SELECT 
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.PRODUTO = @productId
        AND vp.DATA_VENDA >= @previousStartDate
        AND vp.DATA_VENDA < @previousEndDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY vp.FILIAL
    `;

    // Buscar estoque por filial
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
      GROUP BY e.FILIAL
    `;

    const [currentSalesResult, previousSalesResult, stockResult] = await Promise.all([
      request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        FILIAL: string;
        COR_PRODUTO: string | null;
        corBanco: string;
        cost: number | null;
      }>(currentSalesQuery),
      request.query<{
        totalRevenue: number | null;
        FILIAL: string;
      }>(previousSalesQuery),
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
    ]);

    // Calcular totais
    let totalRevenue = 0;
    let totalQuantity = 0;
    let previousRevenue = 0;
    let totalCostWeighted = 0; // Custo total ponderado por quantidade

    const revenueByFilial = new Map<string, number>();
    const quantityByFilial = new Map<string, number>();
    const quantityByColor = new Map<string, number>();
    const revenueByColor = new Map<string, number>();
    const costByColor = new Map<string, number>();
    const colorCodeMap = new Map<string, string>(); // Map cor -> código
    const colorDescMap = new Map<string, string>(); // Map cor -> descrição

    currentSalesResult.recordset.forEach((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const filial = row.FILIAL;
      const cor = row.COR_PRODUTO || 'SEM COR';

      totalRevenue += revenue;
      totalQuantity += quantity;

      revenueByFilial.set(filial, (revenueByFilial.get(filial) ?? 0) + revenue);
      quantityByFilial.set(filial, (quantityByFilial.get(filial) ?? 0) + quantity);
      quantityByColor.set(cor, (quantityByColor.get(cor) ?? 0) + quantity);
      revenueByColor.set(cor, (revenueByColor.get(cor) ?? 0) + revenue);
      
      if (row.cost) {
        const cost = Number(row.cost);
        costByColor.set(cor, cost);
        totalCostWeighted += cost * quantity; // Acumular custo ponderado
      }

      // Armazenar código e descrição da cor
      if (row.COR_PRODUTO) {
        colorCodeMap.set(cor, row.COR_PRODUTO);
        const colorDesc = getColorDescription(row.COR_PRODUTO, row.corBanco);
        colorDescMap.set(cor, colorDesc);
      }
    });

    previousSalesResult.recordset.forEach((row) => {
      previousRevenue += Number(row.totalRevenue ?? 0);
    });

    // Encontrar loja top
    let topFilial: string | null = null;
    let topFilialDisplayName: string | null = null;
    let topFilialRevenue = 0;
    revenueByFilial.forEach((revenue, filial) => {
      if (revenue > topFilialRevenue) {
        topFilialRevenue = revenue;
        topFilial = filial;
        // Normalizar o nome da filial (trim) e aplicar mapeamento
        const normalizedFilial = filial.trim();
        topFilialDisplayName = displayNames[normalizedFilial] ?? displayNames[filial] ?? filial;
      }
    });

    // Encontrar cor mais vendida
    let topColor: string | null = null;
    let topColorCode: string | null = null;
    let topColorDisplayName: string | null = null;
    let topColorQuantity = 0;
    let topColorMarkup = 0;

    quantityByColor.forEach((quantity, color) => {
      if (quantity > topColorQuantity && color !== 'SEM COR') {
        topColorQuantity = quantity;
        topColor = color;
        topColorCode = colorCodeMap.get(color) ?? null;
        topColorDisplayName = colorDescMap.get(color) ?? null;
        const revenue = revenueByColor.get(color) ?? 0;
        const cost = costByColor.get(color) ?? 0;
        topColorMarkup = cost > 0 ? revenue / quantity / cost : 0;
      }
    });

    // Calcular estoque total
    let totalStock = 0;
    stockResult.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      totalStock += finalStock;
    });

    // Calcular variação de receita
    const revenueVariance =
      previousRevenue === 0
        ? (totalRevenue > 0 ? null : 0)
        : Number((((totalRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

    // Calcular markup total
    const averageCost = totalQuantity > 0 ? totalCostWeighted / totalQuantity : 0;
    const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
    const totalMarkup = averageCost > 0 ? averagePrice / averageCost : 0;

    // Converter lastEntryDate para Date se existir
    let lastEntryDate: Date | null = null;
    if (productRow.lastEntryDate) {
      lastEntryDate = productRow.lastEntryDate instanceof Date 
        ? productRow.lastEntryDate 
        : new Date(productRow.lastEntryDate);
    }

    // Aplicar mapeamento para lastEntryFilial
    const lastEntryFilialDisplayName = productRow.lastEntryFilial
      ? (displayNames[productRow.lastEntryFilial] ?? productRow.lastEntryFilial)
      : null;

    return {
      productId: productRow.productId,
      productName: productRow.productName || 'Produto não encontrado',
      lastEntryDate,
      lastEntryFilial: lastEntryFilialDisplayName,
      totalRevenue,
      totalQuantity,
      totalStock,
      totalMarkup,
      averagePrice,
      averageCost,
      topFilial,
      topFilialDisplayName,
      topFilialRevenue,
      topColor,
      topColorCode,
      topColorDisplayName,
      topColorQuantity,
      topColorMarkup,
      revenueVariance,
    };
  });
}

/**
 * Busca estoque e vendas por filial de um produto (apenas ecommerce)
 */
async function fetchProductStockByFilialEcommerce({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductStockByFilial[]> {
  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const companyConfig = resolveCompany(company);
    if (!companyConfig) {
      return [];
    }

    // Construir o filtro de filiais de ecommerce uma vez e reutilizar
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    let estoqueFilialFilter = '';
    let vendasFilialFilter = '';
    
    if (filial) {
      request.input('ecommerceFilial', sql.VarChar, filial);
      estoqueFilialFilter = `AND e.FILIAL = @ecommerceFilial`;
      vendasFilialFilter = `AND f.FILIAL = @ecommerceFilial`;
    } else if (ecommerceFilials.length > 0) {
      // Criar parâmetros uma única vez
      ecommerceFilials.forEach((filialName, index) => {
        request.input(`ecommerceFilial${index}`, sql.VarChar, filialName);
      });
      const placeholders = ecommerceFilials
        .map((_, index) => `@ecommerceFilial${index}`)
        .join(', ');
      estoqueFilialFilter = `AND e.FILIAL IN (${placeholders})`;
      vendasFilialFilter = `AND f.FILIAL IN (${placeholders})`;
    }

    // Buscar estoque por filial
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
        ${estoqueFilialFilter}
      GROUP BY e.FILIAL
    `;

    // Buscar vendas por filial - período atual
    const currentSalesQuery = `
      SELECT 
        f.FILIAL,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY f.FILIAL
    `;

    // Buscar vendas por filial - período anterior
    const previousSalesQuery = `
      SELECT 
        f.FILIAL,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@previousStartDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@previousEndDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY f.FILIAL
    `;

    const [stockResult, currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
        totalQuantity: number | null;
      }>(currentSalesQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
      }>(previousSalesQuery),
    ]);

    // Criar mapas
    const stockMap = new Map<string, number>();
    stockResult.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      stockMap.set(row.FILIAL, finalStock);
    });

    const currentRevenueMap = new Map<string, number>();
    const currentQuantityMap = new Map<string, number>();
    currentSalesResult.recordset.forEach((row) => {
      currentRevenueMap.set(row.FILIAL, Number(row.totalRevenue ?? 0));
      currentQuantityMap.set(row.FILIAL, Number(row.totalQuantity ?? 0));
    });

    const previousRevenueMap = new Map<string, number>();
    previousSalesResult.recordset.forEach((row) => {
      previousRevenueMap.set(row.FILIAL, Number(row.totalRevenue ?? 0));
    });

    // Obter todas as filiais únicas
    const allFiliais = new Set<string>();
    stockMap.forEach((_, filial) => allFiliais.add(filial));
    currentRevenueMap.forEach((_, filial) => allFiliais.add(filial));

    const displayNames = companyConfig.filialDisplayNames ?? {};
    const result: ProductStockByFilial[] = [];

    allFiliais.forEach((filial) => {
      const stock = stockMap.get(filial) ?? 0;
      const revenue = currentRevenueMap.get(filial) ?? 0;
      const quantity = currentQuantityMap.get(filial) ?? 0;
      const previousRevenue = previousRevenueMap.get(filial) ?? 0;

      const revenueVariance =
        previousRevenue === 0
          ? (revenue > 0 ? null : 0)
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

      // Normalizar o nome da filial (trim) e aplicar mapeamento
      const normalizedFilial = filial.trim();
      const filialDisplayName = displayNames[normalizedFilial] ?? displayNames[filial] ?? filial;

      result.push({
        filial,
        filialDisplayName,
        stock,
        revenue,
        quantity,
        revenueVariance,
      });
    });

    return result.sort((a, b) => b.revenue - a.revenue);
  });
}

/**
 * Busca estoque e vendas por filial de um produto
 */
export async function fetchProductStockByFilial({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductStockByFilial[]> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductStockByFilial({ productId, company, range, filial: VAREJO_VALUE }),
      fetchProductStockByFilialEcommerce({ productId, company, range, filial: null }),
    ]);

    const companyConfig = resolveCompany(company);
    const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
    
    // Agregar por filial - usar nome normalizado (trim) como chave para evitar duplicatas
    const filialMap = new Map<string, ProductStockByFilial>();
    
    // Adicionar resultados de vendas normais, excluindo filiais de e-commerce
    salesResult.forEach((item) => {
      const normalizedFilial = (item.filial || '').trim();
      // Excluir filiais de e-commerce do resultado de vendas normais
      if (!ecommerceFilials.includes(normalizedFilial) && !ecommerceFilials.includes(item.filial)) {
        filialMap.set(normalizedFilial, { ...item, filial: normalizedFilial });
      }
    });

    // Adicionar resultados de e-commerce
    ecommerceResult.forEach((item) => {
      const normalizedFilial = (item.filial || '').trim();
      const existing = filialMap.get(normalizedFilial);
      if (existing) {
        existing.revenue += item.revenue;
        existing.quantity += item.quantity;
        // Adicionar estoque do ecommerce ao estoque existente
        existing.stock += item.stock;
        // Garantir que o filialDisplayName está mapeado corretamente
        existing.filialDisplayName = item.filialDisplayName;
        // Recalcular revenueVariance
        const previousRevenue = existing.revenueVariance !== null && existing.revenue > 0
          ? existing.revenue / (1 + existing.revenueVariance / 100)
          : 0;
        const itemPreviousRevenue = item.revenueVariance !== null && item.revenue > 0
          ? item.revenue / (1 + item.revenueVariance / 100)
          : 0;
        const totalPreviousRevenue = previousRevenue + itemPreviousRevenue;
        existing.revenueVariance =
          totalPreviousRevenue === 0
            ? (existing.revenue > 0 ? null : 0)
            : Number((((existing.revenue - totalPreviousRevenue) / totalPreviousRevenue) * 100).toFixed(1));
      } else {
        filialMap.set(normalizedFilial, { ...item, filial: normalizedFilial });
      }
    });

    return Array.from(filialMap.values()).sort((a, b) => b.revenue - a.revenue);
  }

  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const companyConfig = resolveCompany(company);
    if (!companyConfig) {
      return [];
    }

    // Buscar estoque por filial - buscar de todas as filiais e filtrar depois
    // Isso garante que encontramos estoque mesmo se o nome da filial no banco não corresponder exatamente
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
      GROUP BY e.FILIAL
    `;

    // Buscar vendas por filial - período atual
    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp', 'vendasFilial');
    const currentSalesQuery = `
      SELECT 
        vp.FILIAL,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue,
        SUM(vp.QTDE) AS totalQuantity
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.PRODUTO = @productId
        AND vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY vp.FILIAL
    `;

    // Buscar vendas por filial - período anterior
    const previousSalesQuery = `
      SELECT 
        vp.FILIAL,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalRevenue
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      WHERE vp.PRODUTO = @productId
        AND vp.DATA_VENDA >= @previousStartDate
        AND vp.DATA_VENDA < @previousEndDate
        AND vp.QTDE > 0
        ${filialFilter}
      GROUP BY vp.FILIAL
    `;

    const [stockResult, currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
        totalQuantity: number | null;
      }>(currentSalesQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
      }>(previousSalesQuery),
    ]);

    // Criar mapas - normalizar nomes das filiais (trim) para garantir correspondência
    const stockMap = new Map<string, number>();
    stockResult.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      const normalizedFilial = (row.FILIAL || '').trim();
      stockMap.set(normalizedFilial, finalStock);
    });

    const currentRevenueMap = new Map<string, number>();
    const currentQuantityMap = new Map<string, number>();
    currentSalesResult.recordset.forEach((row) => {
      const normalizedFilial = (row.FILIAL || '').trim();
      currentRevenueMap.set(normalizedFilial, Number(row.totalRevenue ?? 0));
      currentQuantityMap.set(normalizedFilial, Number(row.totalQuantity ?? 0));
    });

    const previousRevenueMap = new Map<string, number>();
    previousSalesResult.recordset.forEach((row) => {
      const normalizedFilial = (row.FILIAL || '').trim();
      previousRevenueMap.set(normalizedFilial, Number(row.totalRevenue ?? 0));
    });

    // Obter todas as filiais únicas
    const allFiliais = new Set<string>();
    stockMap.forEach((_, filial) => allFiliais.add(filial));
    currentRevenueMap.forEach((_, filial) => allFiliais.add(filial));

    const displayNames = companyConfig.filialDisplayNames ?? {};
    // Usar filiais de inventory para incluir todas as filiais da empresa (incluindo matriz)
    const filiais = companyConfig.filialFilters['inventory'] ?? [];
    // Normalizar também as filiais da configuração para comparação
    const normalizedFiliais = filiais.map(f => f.trim());
    // Obter filiais de e-commerce normalizadas
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim());

    // Criar resultado
    const result: ProductStockByFilial[] = [];

    allFiliais.forEach((filialName) => {
      // Apenas incluir filiais da empresa (usando inventory para incluir todas as filiais)
      // Comparar com nomes normalizados
      if (!normalizedFiliais.includes(filialName)) {
        return;
      }

      // Se estamos buscando apenas VAREJO, excluir filiais de e-commerce
      if (filial === VAREJO_VALUE && normalizedEcommerceFilials.includes(filialName)) {
        return;
      }

      const stock = stockMap.get(filialName) ?? 0;
      const revenue = currentRevenueMap.get(filialName) ?? 0;
      const quantity = currentQuantityMap.get(filialName) ?? 0;
      const previousRevenue = previousRevenueMap.get(filialName) ?? 0;

      const revenueVariance =
        previousRevenue === 0
          ? (revenue > 0 ? null : 0)
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

      // Aplicar mapeamento (filial já está normalizada)
      const filialDisplayName = displayNames[filialName] ?? filialName;

      result.push({
        filial: filialName,
        filialDisplayName,
        stock,
        revenue,
        quantity,
        revenueVariance,
      });
    });

    // Ordenar por revenue (maior primeiro)
    return result.sort((a, b) => b.revenue - a.revenue);
  });
}

/**
 * Busca histórico de vendas de um produto (apenas ecommerce)
 */
async function fetchProductSaleHistoryEcommerce({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductSaleHistory[]> {
  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = resolveCompany(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = buildEcommerceFilialFilter(request, company, filial, 'f');

    const query = `
      SELECT 
        f.EMISSAO AS date,
        f.FILIAL,
        fp.QTDE AS quantity,
        ISNULL(fp.VALOR_LIQUIDO, 0) AS revenue,
        fp.COR_PRODUTO AS color,
        ISNULL(c.DESC_COR, '') AS corBanco
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
      ORDER BY f.EMISSAO DESC, f.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
      color: string | null;
      corBanco: string;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => {
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      const colorDisplayName = row.color
        ? getColorDescription(row.color, row.corBanco)
        : null;

      return {
        date,
        filial: row.FILIAL,
        filialDisplayName: (() => {
          const normalizedFilial = (row.FILIAL || '').trim();
          return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
        })(),
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
        color: row.color,
        colorDisplayName,
      };
    });
  });
}

/**
 * Busca histórico de vendas de um produto
 */
export async function fetchProductSaleHistory({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductSaleHistory[]> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductSaleHistory({ productId, company, range, filial: VAREJO_VALUE }),
      fetchProductSaleHistoryEcommerce({ productId, company, range, filial: null }),
    ]);

    // Combinar e ordenar por data
    const combined = [...salesResult, ...ecommerceResult];
    return combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = resolveCompany(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');

    const query = `
      SELECT 
        vp.DATA_VENDA AS date,
        vp.FILIAL,
        vp.QTDE AS quantity,
        (
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS revenue,
        vp.COR_PRODUTO AS color,
        ISNULL(c.DESC_COR, '') AS corBanco
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.PRODUTO = @productId
        AND vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
      ORDER BY vp.DATA_VENDA DESC, vp.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
      color: string | null;
      corBanco: string;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => {
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      const colorDisplayName = row.color
        ? getColorDescription(row.color, row.corBanco)
        : null;

      return {
        date,
        filial: row.FILIAL,
        filialDisplayName: (() => {
          const normalizedFilial = (row.FILIAL || '').trim();
          return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
        })(),
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
        color: row.color,
        colorDisplayName,
      };
    });
  });
}

