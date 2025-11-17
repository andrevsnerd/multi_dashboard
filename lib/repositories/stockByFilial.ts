import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import { getColorDescription, normalizeColor } from '@/lib/utils/colorMapping';

export interface StockByFilialParams {
  company?: string;
  filial?: string | null;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
}

export interface FilialStockSales {
  filial: string;
  stock: number;
  sales: number;
  salesLast30Days: number;
}

export interface StockByFilialItem {
  produto: string;
  subgrupo: string;
  grupo: string;
  grade: string;
  descricao: string;
  cor: string;
  totalVendas: number;
  totalEstoque: number;
  filiais: FilialStockSales[];
}

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
    const allFiliais = filiais;
    
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

function buildSalesFilialFilter(
  request: sql.Request,
  companySlug: string | undefined,
  specificFilial?: string | null,
  prefix: string = 'vp'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters['sales'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('salesFilial', sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @salesFilial`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`salesFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@salesFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  // Para scarfme: se for "Todas as filiais" (null), incluir também ecommerce
  if (isScarfme && specificFilial === null) {
    const allFiliais = filiais;
    
    if (allFiliais.length === 0) {
      return '';
    }

    allFiliais.forEach((filial, index) => {
      request.input(`salesFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@salesFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`salesFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@salesFilial${index}`)
    .join(', ');

  return `AND ${prefix}.FILIAL IN (${placeholders})`;
}

/**
 * Busca dados de estoque por filial com informações de produtos e vendas
 */
export async function fetchStockByFilial({
  company,
  filial,
  range,
}: StockByFilialParams = {}): Promise<StockByFilialItem[]> {
  return withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery({
      start: range?.start,
      end: range?.end,
    });

    // Calcular data de 30 dias atrás para verificar vendas recentes
    const thirtyDaysAgo = new Date(end);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildSalesFilialFilter(request, company, filial, 'vp');

    // Buscar estoque agrupado por produto, cor e filial (sem grade)
    // Usando a mesma lógica do top produtos: separar positivos e negativos
    // O estoque por filial deve ser a soma de todas as grades daquele produto+cor
    const estoqueQuery = `
      SELECT 
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        e.FILIAL AS filial,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
      GROUP BY e.PRODUTO, e.COR_PRODUTO, c.DESC_COR, e.FILIAL
    `;

    // Buscar dados de produto para exibição (subgrupo, grupo, grade, descrição)
    // Buscar tanto de estoque quanto de vendas para garantir que todos os produtos apareçam
    const produtoInfoQuery = `
      SELECT DISTINCT
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(p.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
        ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
        ISNULL(p.GRADE, '') AS grade,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(c.DESC_COR, '') AS corBanco
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
      
      UNION
      
        SELECT DISTINCT
          vp.PRODUTO AS produto,
          vp.COR_PRODUTO AS corProduto,
          ISNULL(vp.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
          ISNULL(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
          ISNULL(p.GRADE, '') AS grade,
          ISNULL(vp.DESC_PRODUTO, '') AS descricao,
          ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${vendasFilialFilter}
    `;

    // Buscar vendas agrupadas por produto, cor, tamanho e filial
    // Usar join com CORES_BASICAS para garantir consistência com a query de estoque
    const vendasQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(vp.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
        ISNULL(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
        ISNULL(COALESCE(vp.TAMANHO, p.GRADE), '') AS grade,
        ISNULL(vp.DESC_PRODUTO, '') AS descricao,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, vp.SUBGRUPO_PRODUTO, vp.GRUPO_PRODUTO, COALESCE(vp.TAMANHO, p.GRADE), vp.DESC_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Buscar vendas dos últimos 30 dias por produto+cor+filial (para verificar se teve venda recente)
    const vendasLast30DaysQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @thirtyDaysAgo
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    const [estoqueResult, vendasResult, produtoInfoResult, vendasLast30DaysResult] = await Promise.all([
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(estoqueQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        subgrupo: string;
        grupo: string;
        grade: string;
        descricao: string;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(vendasQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        subgrupo: string;
        grupo: string;
        grade: string;
        descricao: string;
        corBanco: string;
      }>(produtoInfoQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(vendasLast30DaysQuery),
    ]);

    // Função auxiliar para normalizar filial (usar em todos os lugares)
    const normalizeFilial = (filial: string | null | undefined): string => {
      return (filial || '').trim().toUpperCase();
    };

    // Criar mapa de informações de produtos (subgrupo, grupo, grade, descrição) por produto+cor+grade
    const produtoInfoMap = new Map<string, {
      subgrupo: string;
      grupo: string;
      grade: string;
      descricao: string;
    }>();
    
    produtoInfoResult.recordset.forEach((row) => {
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      const key = `${row.produto}|${corNormalizada}|${row.grade || ''}`;
      produtoInfoMap.set(key, {
        subgrupo: row.subgrupo,
        grupo: (row.grupo && row.grupo.trim() !== '') ? row.grupo : 'SEM GRUPO',
        grade: row.grade || '',
        descricao: row.descricao,
      });
    });

    // Criar um mapa para agrupar por produto+cor+grade
    const itemMap = new Map<string, StockByFilialItem>();
    const filiaisMap = new Map<string, Map<string, FilialStockSales>>();
    
    // Criar mapa de vendas dos últimos 30 dias por produto+cor+filial
    const vendasLast30DaysMap = new Map<string, Map<string, number>>();
    vendasLast30DaysResult.recordset.forEach((row) => {
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      const key = `${row.produto}|${corNormalizada}`;
      const filialNormalizada = normalizeFilial(row.filial);
      
      if (!vendasLast30DaysMap.has(key)) {
        vendasLast30DaysMap.set(key, new Map());
      }
      const filiaisVendas = vendasLast30DaysMap.get(key)!;
      filiaisVendas.set(filialNormalizada, Number(row.vendas ?? 0));
    });

    // Processar estoque por produto+cor+filial (sem grade)
    // O estoque de cada filial já está calculado na query (soma de todas as grades)
    estoqueResult.recordset.forEach((row) => {
      // Aplicar a mesma lógica do top produtos
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      
      // Se houver estoque positivo, usar apenas a soma dos positivos
      // Caso contrário, usar a soma dos positivos + negativos
      const estoqueFilial = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      
      // Chave para estoque por filial: produto|cor (normalizada)
      const estoqueKey = `${row.produto}|${corNormalizada}`;
      
      if (!filiaisMap.has(estoqueKey)) {
        filiaisMap.set(estoqueKey, new Map());
      }
      
      const filiais = filiaisMap.get(estoqueKey)!;
      
      // Normalizar filial para garantir consistência
      const filialNormalizada = normalizeFilial(row.filial);
      
      if (!filiais.has(filialNormalizada)) {
        // Buscar vendas dos últimos 30 dias
        const vendasLast30Days = vendasLast30DaysMap.get(estoqueKey)?.get(filialNormalizada) ?? 0;
        
        filiais.set(filialNormalizada, {
          filial: row.filial, // Manter o nome original para exibição
          stock: 0,
          sales: 0,
          salesLast30Days: vendasLast30Days,
        });
      }

      // Atribuir estoque da filial (já calculado na query com soma de todas as grades)
      filiais.get(filialNormalizada)!.stock = estoqueFilial;
    });

    // Processar vendas (agrupadas por produto+cor+grade+filial)
    vendasResult.recordset.forEach((row) => {
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      const key = `${row.produto}|${corNormalizada}|${row.grade || ''}`;
      
      if (!itemMap.has(key)) {
        // Buscar informações do produto do mapa
        const produtoInfo = produtoInfoMap.get(key) || {
          subgrupo: row.subgrupo,
          grupo: (row.grupo && row.grupo.trim() !== '') ? row.grupo : 'SEM GRUPO',
          grade: row.grade || '',
          descricao: row.descricao,
        };
        
        itemMap.set(key, {
          produto: row.produto,
          subgrupo: produtoInfo.subgrupo,
          grupo: produtoInfo.grupo,
          grade: produtoInfo.grade,
          descricao: produtoInfo.descricao,
          cor: corNormalizada, // Usar cor normalizada do mapeamento
          totalVendas: 0,
          totalEstoque: 0,
          filiais: [],
        });
      }

      const item = itemMap.get(key)!;
      const vendas = Number(row.vendas ?? 0);
      item.totalVendas += vendas;

      // Chave para estoque por filial: produto|cor (normalizada, mesma usada no estoque)
      const estoqueKey = `${row.produto}|${corNormalizada}`;
      
      if (!filiaisMap.has(estoqueKey)) {
        filiaisMap.set(estoqueKey, new Map());
      }
      
      const filiais = filiaisMap.get(estoqueKey)!;

      // Normalizar filial para garantir consistência
      const filialNormalizada = normalizeFilial(row.filial);

      if (!filiais.has(filialNormalizada)) {
        // Buscar vendas dos últimos 30 dias
        const vendasLast30Days = vendasLast30DaysMap.get(estoqueKey)?.get(filialNormalizada) ?? 0;
        
        filiais.set(filialNormalizada, {
          filial: row.filial, // Manter o nome original para exibição
          stock: 0,
          sales: 0,
          salesLast30Days: vendasLast30Days,
        });
      }

      // Acumular vendas da filial
      filiais.get(filialNormalizada)!.sales += vendas;
    });

    // Buscar estoque total por produto + cor (agrupado por combinação, sem grade)
    // usando a mesma lógica do top produtos, mas considerando apenas cor
    const estoqueTotalQuery = `
      SELECT 
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
      GROUP BY e.PRODUTO, e.COR_PRODUTO, c.DESC_COR
    `;

    const estoqueTotalResult = await request.query<{
      produto: string;
      corProduto: string | null;
      corBanco: string;
      positiveStock: number | null;
      negativeStock: number | null;
      positiveCount: number | null;
    }>(estoqueTotalQuery);

    // Criar mapa de estoque total por produto + cor
    // Usar mapeamento de cores para garantir consistência
    const stockTotalMap = new Map<string, number>();
    estoqueTotalResult.recordset.forEach((row) => {
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      
      // Aplicar a mesma lógica do top produtos
      const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      
      // Chave: produto|cor (sem grade, normalizada)
      const key = `${row.produto}|${corNormalizada}`;
      stockTotalMap.set(key, finalStock);
    });

    // Converter para array e adicionar filiais e estoque total
    const items: StockByFilialItem[] = Array.from(itemMap.values()).map((item) => {
      // Chave para estoque por filial: produto|cor (sem grade)
      // A cor já está normalizada no item (vem do mapeamento)
      const corNormalizada = normalizeColor(item.cor);
      const estoqueKey = `${item.produto}|${corNormalizada}`;
      const filiais = filiaisMap.get(estoqueKey) ?? new Map();
      item.filiais = Array.from(filiais.values());
      
      // Buscar estoque total (usar mesma normalização)
      const stockKey = `${item.produto}|${corNormalizada}`;
      item.totalEstoque = stockTotalMap.get(stockKey) ?? 0;
      
      return item;
    });

    // Ordenar por total de vendas (maior para menor)
    items.sort((a, b) => b.totalVendas - a.totalVendas);

    return items;
  });
}

