import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { getColorDescription } from '@/lib/utils/colorMapping';

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
 * Busca dados detalhados de um produto específico
 */
export async function fetchProductDetail({
  productId,
  company,
  range,
  filial,
}: ProductDetailParams): Promise<ProductDetailInfo> {
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
        topFilialDisplayName = displayNames[filial] ?? filial;
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

    return {
      productId: productRow.productId,
      productName: productRow.productName || 'Produto não encontrado',
      lastEntryDate,
      lastEntryFilial: productRow.lastEntryFilial,
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
 * Busca estoque e vendas por filial de um produto
 */
export async function fetchProductStockByFilial({
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

    // Buscar vendas por filial - período atual
    const filialFilter = buildFilialFilter(request, company, 'sales', filial, 'vp');
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
    const filiais = companyConfig.filialFilters['sales'] ?? [];

    // Criar resultado
    const result: ProductStockByFilial[] = [];

    allFiliais.forEach((filial) => {
      // Apenas incluir filiais da empresa
      if (!filiais.includes(filial)) {
        return;
      }

      const stock = stockMap.get(filial) ?? 0;
      const revenue = currentRevenueMap.get(filial) ?? 0;
      const quantity = currentQuantityMap.get(filial) ?? 0;
      const previousRevenue = previousRevenueMap.get(filial) ?? 0;

      const revenueVariance =
        previousRevenue === 0
          ? (revenue > 0 ? null : 0)
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

      result.push({
        filial,
        filialDisplayName: displayNames[filial] ?? filial,
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
 * Busca histórico de vendas de um produto
 */
export async function fetchProductSaleHistory({
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
        filialDisplayName: displayNames[row.FILIAL] ?? row.FILIAL,
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
        color: row.color,
        colorDisplayName,
      };
    });
  });
}

