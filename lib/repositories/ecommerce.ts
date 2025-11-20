import sql from 'mssql';

import { resolveCompany, type CompanyModule } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
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
    console.log('[buildEcommerceFilialFilter] DEBUG - Sem companySlug');
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    console.log('[buildEcommerceFilialFilter] DEBUG - Empresa não encontrada:', companySlug);
    return '';
  }

  // Se uma filial específica foi selecionada
  if (specificFilial) {
    request.input('ecommerceFilial', sql.VarChar, specificFilial);
    const filter = `AND ${tableAlias}.FILIAL = @ecommerceFilial`;
    console.log('[buildEcommerceFilialFilter] DEBUG - Filial específica:', specificFilial, 'Filter:', filter);
    return filter;
  }

  // Caso contrário, usar todas as filiais de e-commerce da empresa
  const ecommerceFilials = company.ecommerceFilials ?? [];
  
  console.log('[buildEcommerceFilialFilter] DEBUG - Filiais de e-commerce:', ecommerceFilials);
  
  if (ecommerceFilials.length === 0) {
    console.log('[buildEcommerceFilialFilter] DEBUG - Nenhuma filial de e-commerce encontrada');
    return '';
  }

  ecommerceFilials.forEach((filial, index) => {
    request.input(`ecommerceFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = ecommerceFilials
    .map((_, index) => `@ecommerceFilial${index}`)
    .join(', ');

  const filter = `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  console.log('[buildEcommerceFilialFilter] DEBUG - Filtro gerado:', filter);
  return filter;
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
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
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

    return products;
  });
}

export async function fetchEcommerceSummary({
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

    // Criar filtros para ScarfMe (e-commerce usa apenas p, não vp) - suporta múltiplos
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    let produtoJoin = '';
    
    const linhasList = linhas && linhas.length > 0 ? linhas : linha ? [linha] : [];
    const colecoesList = colecoes && colecoes.length > 0 ? colecoes : colecao ? [colecao] : [];
    const subgruposList = subgrupos && subgrupos.length > 0 ? subgrupos : subgrupo ? [subgrupo] : [];
    const gradesList = grades && grades.length > 0 ? grades : grade ? [grade] : [];
    
    if (company === 'scarfme' && (linhasList.length > 0 || colecoesList.length > 0 || subgruposList.length > 0 || gradesList.length > 0)) {
      produtoJoin = `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO`;
      
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

    // DEBUG: Log dos parâmetros e filtros
    console.log('[fetchEcommerceSummary] DEBUG - Parâmetros:', {
      company,
      filial,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      linha,
      linhas,
      colecao,
      colecoes,
      subgrupo,
      subgrupos,
      grade,
      grades,
    });
    console.log('[fetchEcommerceSummary] DEBUG - Filtros SQL:', {
      filialFilter,
      linhaFilter,
      colecaoFilter,
      subgrupoFilter,
      gradeFilter,
      produtoJoin,
    });

    const query = `
      WITH summary AS (
        SELECT
          'current' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
          SUM(fp.QTDE) AS totalQuantity,
          COUNT(DISTINCT CONCAT(f.NF_SAIDA, '-', f.SERIE_NF)) AS totalTickets,
          MAX(f.EMISSAO) AS lastSaleDate,
          COUNT(*) AS totalRows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        ${produtoJoin}
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
          AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          ${filialFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}

        UNION ALL

        SELECT
          'previous' AS period,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
          SUM(fp.QTDE) AS totalQuantity,
          COUNT(DISTINCT CONCAT(f.NF_SAIDA, '-', f.SERIE_NF)) AS totalTickets,
          MAX(f.EMISSAO) AS lastSaleDate,
          COUNT(*) AS totalRows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        ${produtoJoin}
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@prevStartDate AS DATE)
          AND CAST(f.EMISSAO AS DATE) <= CAST(@prevEndDate AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          ${filialFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
      )
      SELECT period, totalRevenue, totalQuantity, totalTickets, lastSaleDate, totalRows FROM summary;
    `;

    const result = await request.query<{
      period: 'current' | 'previous';
      totalRevenue: number | null;
      totalQuantity: number | null;
      totalTickets: number | null;
      lastSaleDate: Date | null;
      totalRows: number | null;
    }>(query);

    // DEBUG: Log do resultado da query
    console.log('[fetchEcommerceSummary] DEBUG - Resultado da query:', {
      current: result.recordset.find(r => r.period === 'current'),
      previous: result.recordset.find(r => r.period === 'previous'),
      allRows: result.recordset,
    });

    const currentRow =
      result.recordset.find((row) => row.period === 'current') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
        lastSaleDate: null,
        totalRows: 0,
      };
    const previousRow =
      result.recordset.find((row) => row.period === 'previous') ?? {
        totalRevenue: 0,
        totalQuantity: 0,
        totalTickets: 0,
        lastSaleDate: null,
        totalRows: 0,
      };

    // DEBUG: Log dos valores calculados
    console.log('[fetchEcommerceSummary] DEBUG - Valores calculados:', {
      currentRevenue: Number(currentRow.totalRevenue ?? 0),
      currentQuantity: Number(currentRow.totalQuantity ?? 0),
      currentTickets: Number(currentRow.totalTickets ?? 0),
      currentRows: Number(currentRow.totalRows ?? 0),
      previousRevenue: Number(previousRow.totalRevenue ?? 0),
      previousQuantity: Number(previousRow.totalQuantity ?? 0),
      previousTickets: Number(previousRow.totalTickets ?? 0),
      previousRows: Number(previousRow.totalRows ?? 0),
    });

    // DEBUG: Query de teste para comparar com a planilha (sem filtros de produto)
    const testQuery = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;
    
    try {
      const testResult = await request.query<{
        totalRevenue: number | null;
        totalRows: number | null;
        totalNotas: number | null;
      }>(testQuery);
      
      console.log('[fetchEcommerceSummary] DEBUG - Query de teste (sem filtros de produto):', {
        totalRevenue: Number(testResult.recordset[0]?.totalRevenue ?? 0),
        totalRows: Number(testResult.recordset[0]?.totalRows ?? 0),
        totalNotas: Number(testResult.recordset[0]?.totalNotas ?? 0),
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de teste:', error);
    }

    // DEBUG: Query de teste sem nenhum filtro (para comparar com a planilha completa)
    const testQueryNoFilters = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas,
        MIN(f.EMISSAO) AS primeiraData,
        MAX(f.EMISSAO) AS ultimaData
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
    `;
    
    try {
      const testResultNoFilters = await request.query<{
        totalRevenue: number | null;
        totalRows: number | null;
        totalNotas: number | null;
        primeiraData: Date | null;
        ultimaData: Date | null;
      }>(testQueryNoFilters);
      
      console.log('[fetchEcommerceSummary] DEBUG - Query de teste (SEM NENHUM FILTRO - deve ser igual à planilha):', {
        totalRevenue: Number(testResultNoFilters.recordset[0]?.totalRevenue ?? 0),
        totalRows: Number(testResultNoFilters.recordset[0]?.totalRows ?? 0),
        totalNotas: Number(testResultNoFilters.recordset[0]?.totalNotas ?? 0),
        primeiraData: testResultNoFilters.recordset[0]?.primeiraData,
        ultimaData: testResultNoFilters.recordset[0]?.ultimaData,
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de teste sem filtros:', error);
    }

    // DEBUG: Query EXATA da planilha - FILIAL específica, EMISSAO em novembro até dia 20, soma VALOR_LIQUIDO e QTDE
    // Esta query deve retornar exatamente 400.056,09 e 1845
    // IMPORTANTE: A planilha pode estar usando LEFT JOIN em vez de INNER JOIN
    const testQueryExataPlanilha = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(ISNULL(fp.QTDE, 0)) AS totalQuantity,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas,
        MIN(f.EMISSAO) AS primeiraData,
        MAX(f.EMISSAO) AS ultimaData,
        COUNT(CASE WHEN fp.VALOR_LIQUIDO IS NULL THEN 1 END) AS rowsValorLiquidoNull,
        COUNT(CASE WHEN fp.VALOR_LIQUIDO = 0 THEN 1 END) AS rowsValorLiquidoZero,
        COUNT(CASE WHEN fp.QTDE IS NULL THEN 1 END) AS rowsQtdeNull,
        COUNT(CASE WHEN fp.QTDE = 0 THEN 1 END) AS rowsQtdeZero,
        COUNT(CASE WHEN fp.QTDE < 0 THEN 1 END) AS rowsQtdeNegativo
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;

    // DEBUG: Query com LEFT JOIN (como na planilha) para verificar se há diferença
    const testQueryLeftJoin = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(ISNULL(fp.QTDE, 0)) AS totalQuantity,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas,
        COUNT(CASE WHEN fp.PRODUTO IS NULL THEN 1 END) AS rowsSemProduto
      FROM FATURAMENTO f WITH (NOLOCK)
      LEFT JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;

    // DEBUG: Verificar se há problema com espaços em branco no nome da filial
    const testQueryFilialTrim = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(ISNULL(fp.QTDE, 0)) AS totalQuantity,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT LTRIM(RTRIM(f.FILIAL))) AS filiaisDistintas,
        COUNT(DISTINCT LTRIM(RTRIM(fp.FILIAL))) AS filiaisProdutosDistintas
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(fp.FILIAL)) 
        AND f.NF_SAIDA = fp.NF_SAIDA 
        AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@ecommerceFilial))
    `;
    
    try {
      const testResultExata = await request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        totalRows: number | null;
        totalNotas: number | null;
        primeiraData: Date | null;
        ultimaData: Date | null;
        rowsValorLiquidoNull: number | null;
        rowsValorLiquidoZero: number | null;
        rowsQtdeNull: number | null;
        rowsQtdeZero: number | null;
        rowsQtdeNegativo: number | null;
      }>(testQueryExataPlanilha);
      
      const row = testResultExata.recordset[0];
      console.log('[fetchEcommerceSummary] DEBUG - Query EXATA da planilha (FILIAL + EMISSAO novembro até dia 20) - INNER JOIN:', {
        totalRevenue: Number(row?.totalRevenue ?? 0),
        totalQuantity: Number(row?.totalQuantity ?? 0),
        totalRows: Number(row?.totalRows ?? 0),
        totalNotas: Number(row?.totalNotas ?? 0),
        primeiraData: row?.primeiraData,
        ultimaData: row?.ultimaData,
        rowsValorLiquidoNull: Number(row?.rowsValorLiquidoNull ?? 0),
        rowsValorLiquidoZero: Number(row?.rowsValorLiquidoZero ?? 0),
        rowsQtdeNull: Number(row?.rowsQtdeNull ?? 0),
        rowsQtdeZero: Number(row?.rowsQtdeZero ?? 0),
        rowsQtdeNegativo: Number(row?.rowsQtdeNegativo ?? 0),
        esperadoNaPlanilha: {
          totalRevenue: 400056.09,
          totalQuantity: 1845,
        },
        diferenca: {
          totalRevenue: Number(row?.totalRevenue ?? 0) - 400056.09,
          totalQuantity: Number(row?.totalQuantity ?? 0) - 1845,
        },
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query exata da planilha:', error);
    }

    // Testar com LEFT JOIN
    try {
      const testResultLeftJoin = await request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        totalRows: number | null;
        totalNotas: number | null;
        rowsSemProduto: number | null;
      }>(testQueryLeftJoin);
      
      const rowLeft = testResultLeftJoin.recordset[0];
      console.log('[fetchEcommerceSummary] DEBUG - Query com LEFT JOIN (como na planilha):', {
        totalRevenue: Number(rowLeft?.totalRevenue ?? 0),
        totalQuantity: Number(rowLeft?.totalQuantity ?? 0),
        totalRows: Number(rowLeft?.totalRows ?? 0),
        totalNotas: Number(rowLeft?.totalNotas ?? 0),
        rowsSemProduto: Number(rowLeft?.rowsSemProduto ?? 0),
        esperadoNaPlanilha: {
          totalRevenue: 400056.09,
          totalQuantity: 1845,
        },
        diferenca: {
          totalRevenue: Number(rowLeft?.totalRevenue ?? 0) - 400056.09,
          totalQuantity: Number(rowLeft?.totalQuantity ?? 0) - 1845,
        },
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query com LEFT JOIN:', error);
    }

    // Testar com TRIM no filtro de filial (pode haver espaços em branco)
    if (filial) {
      try {
        request.input('ecommerceFilialTrim', sql.VarChar, filial.trim());
        const testResultTrim = await request.query<{
          totalRevenue: number | null;
          totalQuantity: number | null;
          totalRows: number | null;
          filiaisDistintas: number | null;
          filiaisProdutosDistintas: number | null;
        }>(testQueryFilialTrim);
        
        const rowTrim = testResultTrim.recordset[0];
        console.log('[fetchEcommerceSummary] DEBUG - Query com TRIM no filtro de filial:', {
          totalRevenue: Number(rowTrim?.totalRevenue ?? 0),
          totalQuantity: Number(rowTrim?.totalQuantity ?? 0),
          totalRows: Number(rowTrim?.totalRows ?? 0),
          filiaisDistintas: Number(rowTrim?.filiaisDistintas ?? 0),
          filiaisProdutosDistintas: Number(rowTrim?.filiaisProdutosDistintas ?? 0),
          esperadoNaPlanilha: {
            totalRevenue: 400056.09,
            totalQuantity: 1845,
          },
          diferenca: {
            totalRevenue: Number(rowTrim?.totalRevenue ?? 0) - 400056.09,
            totalQuantity: Number(rowTrim?.totalQuantity ?? 0) - 1845,
          },
        });
      } catch (error) {
        console.error('[fetchEcommerceSummary] DEBUG - Erro na query com TRIM:', error);
      }
    }

    // DEBUG: Query com filtro de data incluindo o dia 20 completo (usando <= em vez de <)
    // A planilha pode estar incluindo o dia 20 completo, enquanto nossa query usa < @endDate
    const testQueryDataInclusiva = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(ISNULL(fp.QTDE, 0)) AS totalQuantity,
        COUNT(*) AS totalRows,
        COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas,
        MIN(f.EMISSAO) AS primeiraData,
        MAX(f.EMISSAO) AS ultimaData,
        COUNT(CASE WHEN CAST(f.EMISSAO AS DATE) = CAST(@endDate AS DATE) THEN 1 END) AS rowsNoDia20
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;
    
    try {
      const testResultDataInclusiva = await request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        totalRows: number | null;
        totalNotas: number | null;
        primeiraData: Date | null;
        ultimaData: Date | null;
        rowsNoDia20: number | null;
      }>(testQueryDataInclusiva);
      
      const rowData = testResultDataInclusiva.recordset[0];
      console.log('[fetchEcommerceSummary] DEBUG - Query com data INCLUSIVA (incluindo dia 20 completo):', {
        totalRevenue: Number(rowData?.totalRevenue ?? 0),
        totalQuantity: Number(rowData?.totalQuantity ?? 0),
        totalRows: Number(rowData?.totalRows ?? 0),
        totalNotas: Number(rowData?.totalNotas ?? 0),
        primeiraData: rowData?.primeiraData,
        ultimaData: rowData?.ultimaData,
        rowsNoDia20: Number(rowData?.rowsNoDia20 ?? 0),
        esperadoNaPlanilha: {
          totalRevenue: 400056.09,
          totalQuantity: 1845,
        },
        diferenca: {
          totalRevenue: Number(rowData?.totalRevenue ?? 0) - 400056.09,
          totalQuantity: Number(rowData?.totalQuantity ?? 0) - 1845,
        },
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query com data inclusiva:', error);
    }

    // DEBUG: Query de teste para verificar se há registros com QTDE <= 0 que têm VALOR_LIQUIDO
    const testQueryComQTDE = `
      SELECT 
        SUM(CASE WHEN fp.QTDE > 0 THEN ISNULL(fp.VALOR_LIQUIDO, 0) ELSE 0 END) AS totalRevenueComQTDE,
        SUM(CASE WHEN fp.QTDE <= 0 THEN ISNULL(fp.VALOR_LIQUIDO, 0) ELSE 0 END) AS totalRevenueSemQTDE,
        COUNT(CASE WHEN fp.QTDE > 0 THEN 1 END) AS rowsComQTDE,
        COUNT(CASE WHEN fp.QTDE <= 0 THEN 1 END) AS rowsSemQTDE,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenueTodos,
        COUNT(*) AS totalRowsTodos
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;
    
    try {
      const testResultQTDE = await request.query<{
        totalRevenueComQTDE: number | null;
        totalRevenueSemQTDE: number | null;
        rowsComQTDE: number | null;
        rowsSemQTDE: number | null;
        totalRevenueTodos: number | null;
        totalRowsTodos: number | null;
      }>(testQueryComQTDE);
      
      console.log('[fetchEcommerceSummary] DEBUG - Análise por QTDE:', {
        totalRevenueComQTDE: Number(testResultQTDE.recordset[0]?.totalRevenueComQTDE ?? 0),
        totalRevenueSemQTDE: Number(testResultQTDE.recordset[0]?.totalRevenueSemQTDE ?? 0),
        rowsComQTDE: Number(testResultQTDE.recordset[0]?.rowsComQTDE ?? 0),
        rowsSemQTDE: Number(testResultQTDE.recordset[0]?.rowsSemQTDE ?? 0),
        totalRevenueTodos: Number(testResultQTDE.recordset[0]?.totalRevenueTodos ?? 0),
        totalRowsTodos: Number(testResultQTDE.recordset[0]?.totalRowsTodos ?? 0),
        esperadoNaPlanilha: 400056.09,
        diferenca: Number(testResultQTDE.recordset[0]?.totalRevenueTodos ?? 0) - 400056.09,
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de análise por QTDE:', error);
    }

    // DEBUG: Query para verificar se há registros excluídos por algum motivo
    const testQueryDetalhada = `
      SELECT 
        f.NF_SAIDA,
        f.SERIE_NF,
        f.EMISSAO,
        fp.PRODUTO,
        fp.QTDE,
        fp.VALOR_LIQUIDO,
        f.NOTA_CANCELADA,
        f.NATUREZA_SAIDA,
        f.FILIAL
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
      ORDER BY f.EMISSAO DESC, fp.VALOR_LIQUIDO DESC
    `;
    
    try {
      const testResultDetalhada = await request.query<{
        NF_SAIDA: string;
        SERIE_NF: string;
        EMISSAO: Date;
        PRODUTO: string;
        QTDE: number;
        VALOR_LIQUIDO: number;
        NOTA_CANCELADA: number;
        NATUREZA_SAIDA: string;
        FILIAL: string;
      }>(testQueryDetalhada);
      
      const totalDetalhado = testResultDetalhada.recordset.reduce((sum, row) => {
        return sum + Number(row.VALOR_LIQUIDO ?? 0);
      }, 0);
      
      console.log('[fetchEcommerceSummary] DEBUG - Query detalhada (primeiros 10 registros):', {
        totalRegistros: testResultDetalhada.recordset.length,
        totalDetalhado: totalDetalhado,
        primeiros10: testResultDetalhada.recordset.slice(0, 10).map(r => ({
          NF: `${r.NF_SAIDA}-${r.SERIE_NF}`,
          EMISSAO: r.EMISSAO,
          PRODUTO: r.PRODUTO,
          QTDE: r.QTDE,
          VALOR_LIQUIDO: r.VALOR_LIQUIDO,
          FILIAL: r.FILIAL,
        })),
        esperadoNaPlanilha: 400056.09,
        diferenca: totalDetalhado - 400056.09,
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query detalhada:', error);
    }

    // DEBUG: Verificar se há registros em FATURAMENTO que não fazem JOIN com W_FATURAMENTO_PROD_02
    const testQuerySemJoin = `
      SELECT 
        COUNT(*) AS totalFaturas,
        SUM(ISNULL(f.VALOR_TOTAL, 0)) AS valorTotalFaturas
      FROM FATURAMENTO f WITH (NOLOCK)
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        AND NOT EXISTS (
          SELECT 1 
          FROM W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          WHERE fp.FILIAL = f.FILIAL 
            AND fp.NF_SAIDA = f.NF_SAIDA 
            AND fp.SERIE_NF = f.SERIE_NF
        )
    `;
    
    try {
      const testResultSemJoin = await request.query<{
        totalFaturas: number | null;
        valorTotalFaturas: number | null;
      }>(testQuerySemJoin);
      
      console.log('[fetchEcommerceSummary] DEBUG - Faturas sem produtos (não fazem JOIN):', {
        totalFaturas: Number(testResultSemJoin.recordset[0]?.totalFaturas ?? 0),
        valorTotalFaturas: Number(testResultSemJoin.recordset[0]?.valorTotalFaturas ?? 0),
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de faturas sem JOIN:', error);
    }

    // DEBUG: Verificar se a planilha pode estar usando outra coluna ou cálculo
    const testQueryTodasColunas = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
        SUM(ISNULL(fp.VALOR, 0)) AS totalValor,
        SUM(ISNULL(fp.VALOR_PRODUCAO, 0)) AS totalValorProducao,
        SUM(ISNULL(fp.PRECO * fp.QTDE, 0)) AS totalPrecoQtde,
        SUM(ISNULL(fp.VALOR_LIQUIDO + fp.DIF_PRODUCAO_LIQUIDO, 0)) AS totalValorLiquidoComDiferenca,
        SUM(ISNULL(fp.VALOR + fp.DIF_PRODUCAO, 0)) AS totalValorComDiferenca,
        COUNT(*) AS totalRows
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;
    
    try {
      const testResultTodasColunas = await request.query<{
        totalValorLiquido: number | null;
        totalValor: number | null;
        totalValorProducao: number | null;
        totalPrecoQtde: number | null;
        totalValorLiquidoComDiferenca: number | null;
        totalValorComDiferenca: number | null;
        totalRows: number | null;
      }>(testQueryTodasColunas);
      
      const row = testResultTodasColunas.recordset[0];
      console.log('[fetchEcommerceSummary] DEBUG - Comparação de colunas diferentes:', {
        totalValorLiquido: Number(row?.totalValorLiquido ?? 0),
        totalValor: Number(row?.totalValor ?? 0),
        totalValorProducao: Number(row?.totalValorProducao ?? 0),
        totalPrecoQtde: Number(row?.totalPrecoQtde ?? 0),
        totalValorLiquidoComDiferenca: Number(row?.totalValorLiquidoComDiferenca ?? 0),
        totalValorComDiferenca: Number(row?.totalValorComDiferenca ?? 0),
        totalRows: Number(row?.totalRows ?? 0),
        esperadoNaPlanilha: 400056.09,
        diferencaValorLiquido: Number(row?.totalValorLiquido ?? 0) - 400056.09,
        diferencaValor: Number(row?.totalValor ?? 0) - 400056.09,
        diferencaValorLiquidoComDiferenca: Number(row?.totalValorLiquidoComDiferenca ?? 0) - 400056.09,
        diferencaValorComDiferenca: Number(row?.totalValorComDiferenca ?? 0) - 400056.09,
      });
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de comparação de colunas:', error);
    }

    // DEBUG: Verificar se há registros com valores NULL ou zero que podem estar sendo incluídos na planilha
    const testQueryNulls = `
      SELECT 
        COUNT(*) AS totalRows,
        COUNT(CASE WHEN fp.VALOR_LIQUIDO IS NULL THEN 1 END) AS rowsValorLiquidoNull,
        COUNT(CASE WHEN fp.VALOR_LIQUIDO = 0 THEN 1 END) AS rowsValorLiquidoZero,
        COUNT(CASE WHEN fp.VALOR IS NULL THEN 1 END) AS rowsValorNull,
        COUNT(CASE WHEN fp.VALOR = 0 THEN 1 END) AS rowsValorZero,
        SUM(CASE WHEN fp.VALOR_LIQUIDO IS NULL THEN ISNULL(fp.VALOR, 0) ELSE 0 END) AS somaValorQuandoLiquidoNull,
        SUM(CASE WHEN fp.VALOR_LIQUIDO = 0 AND fp.VALOR <> 0 THEN ISNULL(fp.VALOR, 0) ELSE 0 END) AS somaValorQuandoLiquidoZero
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
    `;
    
    try {
      const testResultNulls = await request.query<{
        totalRows: number | null;
        rowsValorLiquidoNull: number | null;
        rowsValorLiquidoZero: number | null;
        rowsValorNull: number | null;
        rowsValorZero: number | null;
        somaValorQuandoLiquidoNull: number | null;
        somaValorQuandoLiquidoZero: number | null;
      }>(testQueryNulls);
      
      console.log('[fetchEcommerceSummary] DEBUG - Análise de valores NULL e zero:', testResultNulls.recordset[0]);
    } catch (error) {
      console.error('[fetchEcommerceSummary] DEBUG - Erro na query de análise de NULLs:', error);
    }

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
    // IMPORTANTE: Passar todos os filtros (valores únicos e arrays) para garantir que o estoque seja filtrado corretamente
    // IMPORTANTE: Para e-commerce, quando filial é null, significa "todas as filiais de e-commerce"
    // Mas fetchStockSummary com filial=null busca todas as filiais (varejo + ecommerce)
    // Solução: quando filial é null em contexto de e-commerce, devemos buscar estoque apenas das filiais de e-commerce
    // Vamos modificar fetchStockSummary para aceitar um parâmetro adicional "ecommerceOnly"
    const stockSummary = await fetchStockSummary({
      company,
      filial, // Se for null, buscará todas as filiais (mas precisamos ajustar para buscar apenas e-commerce)
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
      ecommerceOnly: !filial, // Se filial é null, buscar apenas filiais de e-commerce
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

    // Buscar disponibilidade de datas usando withRequest para suportar proxy
    const availabilityRow = await withRequest(async (availabilityRequest) => {
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
          ${availabilityFilter}
      `;

      const availabilityResult = await availabilityRequest.query<{
        firstSaleDate: Date | null;
        lastSaleDate: Date | null;
      }>(availabilityQuery);

      return availabilityResult.recordset[0] ?? {
        firstSaleDate: null,
        lastSaleDate: null,
      };
    });

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
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
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
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
      GROUP BY CAST(f.EMISSAO AS DATE)
      ORDER BY date ASC;
    `;

    const result = await request.query<{
      date: Date;
      revenue: number | null;
    }>(query);

    return result.recordset.map((row) => {
      // Converter para Date se for string (vindo do proxy)
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      return {
        date: date.toISOString().split('T')[0],
        revenue: Number(row.revenue ?? 0),
      };
    });
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
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
          AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
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
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@prevStartDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) <= CAST(@prevEndDate AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
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

