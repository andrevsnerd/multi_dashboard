import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import { getColorDescription, normalizeColor } from '@/lib/utils/colorMapping';
import { buildEntriesMap } from '@/lib/repositories/entries';

export interface StockByFilialParams {
  company?: string;
  filial?: string | null;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
  linha?: string | null;
  subgrupo?: string | null;
  grade?: string | null;
  colecao?: string | null;
}

export interface FilialStockSales {
  filial: string;
  stock: number;
  sales: number;
  salesLast30Days: number;
  hasEntry: boolean;
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
  linha?: string;
  colecao?: string;
}

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

/**
 * Cria filtro de linha/grupo para NERD (apenas ELETRONICOS)
 * Verifica tanto LINHA quanto GRUPO_PRODUTO para garantir que funcione
 */
function buildGrupoFilter(
  companySlug: string | undefined,
  prefix: string = 'p'
): string {
  if (companySlug === 'nerd') {
    // Verificar tanto LINHA quanto GRUPO_PRODUTO, normalizando com UPPER e TRIM
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) = 'ELETRONICOS'
      OR UPPER(LTRIM(RTRIM(ISNULL(${prefix}.GRUPO_PRODUTO, '')))) = 'ELETRONICOS'
    )`;
  }
  return '';
}

/**
 * Cria filtro de linha para ScarfMe
 */
function buildLinhaFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  linha: string | null | undefined,
  prefix: string = 'p'
): string {
  if (companySlug !== 'scarfme' || !linha) {
    return '';
  }
  request.input('linha', sql.VarChar, linha);
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) = UPPER(LTRIM(RTRIM(@linha)))`;
}

/**
 * Cria filtro de subgrupo para ScarfMe
 */
function buildSubgrupoFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  subgrupo: string | null | undefined,
  prefix: string = 'p'
): string {
  if (companySlug !== 'scarfme' || !subgrupo) {
    return '';
  }
  request.input('subgrupo', sql.VarChar, subgrupo);
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.SUBGRUPO_PRODUTO, '')))) = UPPER(LTRIM(RTRIM(@subgrupo)))`;
}

/**
 * Cria filtro de grade para ScarfMe
 */
function buildGradeFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grade: string | null | undefined,
  prefix: string = 'p'
): string {
  if (companySlug !== 'scarfme' || !grade) {
    return '';
  }
  request.input('grade', sql.VarChar, grade);
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, ${prefix}.GRADE), '')))) = UPPER(LTRIM(RTRIM(@grade)))`;
}

/**
 * Cria filtro de linha para vendas (ScarfMe)
 */
function buildLinhaFilterForSales(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  linha: string | null | undefined
): string {
  if (companySlug !== 'scarfme' || !linha) {
    return '';
  }
  request.input('linhaVendas', sql.VarChar, linha);
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) = UPPER(LTRIM(RTRIM(@linhaVendas)))
    OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = UPPER(LTRIM(RTRIM(@linhaVendas)))
  )`;
}

/**
 * Cria filtro de subgrupo para vendas (ScarfMe)
 */
function buildSubgrupoFilterForSales(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  subgrupo: string | null | undefined
): string {
  if (companySlug !== 'scarfme' || !subgrupo) {
    return '';
  }
  request.input('subgrupoVendas', sql.VarChar, subgrupo);
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) = UPPER(LTRIM(RTRIM(@subgrupoVendas)))
    OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = UPPER(LTRIM(RTRIM(@subgrupoVendas)))
  )`;
}

/**
 * Cria filtro de grade para vendas (ScarfMe)
 */
function buildGradeFilterForSales(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grade: string | null | undefined
): string {
  if (companySlug !== 'scarfme' || !grade) {
    return '';
  }
  request.input('gradeVendas', sql.VarChar, grade);
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = UPPER(LTRIM(RTRIM(@gradeVendas)))`;
}

/**
 * Cria filtro de coleção para ScarfMe
 */
function buildColecaoFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  colecao: string | null | undefined,
  prefix: string = 'p'
): string {
  if (companySlug !== 'scarfme' || !colecao) {
    return '';
  }
  request.input('colecao', sql.VarChar, colecao);
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.COLECAO, '')))) = UPPER(LTRIM(RTRIM(@colecao)))`;
}

/**
 * Cria filtro de coleção para vendas (ScarfMe)
 */
function buildColecaoFilterForSales(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  colecao: string | null | undefined
): string {
  if (companySlug !== 'scarfme' || !colecao) {
    return '';
  }
  request.input('colecaoVendas', sql.VarChar, colecao);
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) = UPPER(LTRIM(RTRIM(@colecaoVendas)))
    OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = UPPER(LTRIM(RTRIM(@colecaoVendas)))
  )`;
}

/**
 * Cria filtro de linha/grupo para NERD nas queries de vendas
 * Verifica tanto na tabela de vendas (vp) quanto na tabela de produtos (p)
 */
function buildGrupoFilterForSales(
  companySlug: string | undefined
): string {
  if (companySlug === 'nerd') {
    // Verificar tanto LINHA quanto GRUPO_PRODUTO em ambas as tabelas
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) = 'ELETRONICOS'
      OR UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) = 'ELETRONICOS'
      OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'ELETRONICOS'
      OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = 'ELETRONICOS'
    )`;
  }
  return '';
}

function buildSalesFilialFilter(
  request: sql.Request | RequestLike,
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
  linha,
  subgrupo,
  grade,
  colecao,
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
    const grupoFilter = buildGrupoFilter(company, 'p');
    // Para vendas, verificar tanto vp quanto p (produtos) para LINHA e GRUPO_PRODUTO
    const grupoFilterVendas = buildGrupoFilterForSales(company);
    
    // Filtros específicos para ScarfMe
    const linhaFilter = buildLinhaFilter(request, company, linha, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupo, 'p');
    const gradeFilter = buildGradeFilter(request, company, grade, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecao, 'p');
    const linhaFilterVendas = buildLinhaFilterForSales(request, company, linha);
    const subgrupoFilterVendas = buildSubgrupoFilterForSales(request, company, subgrupo);
    const gradeFilterVendas = buildGradeFilterForSales(request, company, grade);
    const colecaoFilterVendas = buildColecaoFilterForSales(request, company, colecao);

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
        ${grupoFilter}
        ${linhaFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${colecaoFilter}
      GROUP BY e.PRODUTO, e.COR_PRODUTO, c.DESC_COR, e.FILIAL
    `;

    // Buscar dados de produto para exibição (subgrupo, grupo, grade, descrição, linha, coleção)
    // Buscar tanto de estoque quanto de vendas para garantir que todos os produtos apareçam
    const produtoInfoQuery = `
      SELECT DISTINCT
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(p.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
        ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(c.DESC_COR, '') AS corBanco,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.COLECAO, '') AS colecao
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${colecaoFilter}
      
      UNION
      
        SELECT DISTINCT
          vp.PRODUTO AS produto,
          vp.COR_PRODUTO AS corProduto,
          ISNULL(vp.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
          ISNULL(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
          ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
          ISNULL(vp.DESC_PRODUTO, '') AS descricao,
          ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
          ISNULL(COALESCE(vp.LINHA, p.LINHA), '') AS linha,
          ISNULL(COALESCE(vp.COLECAO, p.COLECAO), '') AS colecao
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${vendasFilialFilter}
          ${grupoFilterVendas}
          ${linhaFilterVendas}
          ${subgrupoFilterVendas}
          ${gradeFilterVendas}
          ${colecaoFilterVendas}
    `;

    // Buscar vendas agrupadas por produto, cor, grade e filial
    // Usar join com CORES_BASICAS para garantir consistência com a query de estoque
    // GRADE vem da tabela PRODUTOS (p.GRADE), não de vp.TAMANHO
    const vendasQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(vp.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
        ISNULL(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
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
        ${grupoFilterVendas}
        ${linhaFilterVendas}
        ${subgrupoFilterVendas}
        ${gradeFilterVendas}
        ${colecaoFilterVendas}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, vp.SUBGRUPO_PRODUTO, vp.GRUPO_PRODUTO, p.GRADE, vp.DESC_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Buscar vendas dos últimos 30 dias por produto+cor+filial (para verificar se teve venda recente)
    // Para esta query, precisamos adicionar JOIN com PRODUTOS se for NERD ou ScarfMe para aplicar os filtros
    const vendasLast30DaysQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      ${company === 'nerd' || company === 'scarfme' ? 'LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO' : ''}
      WHERE vp.DATA_VENDA >= @thirtyDaysAgo
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilterVendas}
        ${linhaFilterVendas}
        ${subgrupoFilterVendas}
        ${gradeFilterVendas}
        ${colecaoFilterVendas}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Buscar mapa de entradas - busca TODO O HISTÓRICO (sem filtro de período)
    // Isso é usado especificamente para a regra roxa: detectar produtos que NUNCA tiveram entrada
    // naquela filial, independente do período selecionado
    const [estoqueResult, vendasResult, produtoInfoResult, vendasLast30DaysResult, entriesMap] = await Promise.all([
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
        linha: string;
        colecao: string;
      }>(produtoInfoQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(vendasLast30DaysQuery),
      buildEntriesMap(company, filial), // Busca todo o histórico, não apenas o período selecionado
    ]);

    // Função auxiliar para normalizar filial (usar em todos os lugares)
    const normalizeFilial = (filial: string | null | undefined): string => {
      return (filial || '').trim().toUpperCase();
    };

    // Criar mapa de informações de produtos (subgrupo, grupo, grade, descrição, linha, coleção) por produto+cor+grade
    const produtoInfoMap = new Map<string, {
      subgrupo: string;
      grupo: string;
      grade: string;
      descricao: string;
      linha: string;
      colecao: string;
    }>();
    
    produtoInfoResult.recordset.forEach((row) => {
      // Normalizar código do produto para garantir consistência
      const produtoNormalizado = (row.produto || '').trim().toUpperCase();
      
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      
      // Normalizar grade - garantir que seja string e tratar valores nulos/vazios
      // A grade vem da query como CONVERT(VARCHAR, p.GRADE) tanto para estoque quanto para vendas
      let gradeNormalizada = '';
      if (row.grade != null) {
        const gradeStr = String(row.grade).trim();
        // Remover espaços extras e garantir que não seja apenas espaços
        gradeNormalizada = gradeStr || '';
      }
      
      const key = `${produtoNormalizado}|${corNormalizada}|${gradeNormalizada}`;
      produtoInfoMap.set(key, {
        subgrupo: row.subgrupo,
        grupo: (row.grupo && row.grupo.trim() !== '') ? row.grupo : 'SEM GRUPO',
        grade: gradeNormalizada, // Armazenar a grade normalizada
        descricao: row.descricao,
        linha: (row.linha || '').trim().toUpperCase(),
        colecao: (row.colecao || '').trim().toUpperCase(),
      });
    });

    // Criar um mapa para agrupar por produto+cor+grade
    const itemMap = new Map<string, StockByFilialItem>();
    const filiaisMap = new Map<string, Map<string, FilialStockSales>>();
    
    // Criar mapa de vendas dos últimos 30 dias por produto+cor+filial
    const vendasLast30DaysMap = new Map<string, Map<string, number>>();
    vendasLast30DaysResult.recordset.forEach((row) => {
      // Normalizar código do produto para garantir consistência
      const produtoNormalizado = (row.produto || '').trim().toUpperCase();
      
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      const key = `${produtoNormalizado}|${corNormalizada}`;
      const filialNormalizada = normalizeFilial(row.filial);
      
      if (!vendasLast30DaysMap.has(key)) {
        vendasLast30DaysMap.set(key, new Map());
      }
      const filiaisVendas = vendasLast30DaysMap.get(key)!;
      filiaisVendas.set(filialNormalizada, Number(row.vendas ?? 0));
    });

    // Processar estoque por produto+cor+filial (sem grade)
    // O estoque de cada filial já está calculado na query (soma de todas as grades)
    // Também precisamos criar itens no itemMap para produtos que têm estoque mas não têm vendas
    estoqueResult.recordset.forEach((row) => {
      // Aplicar a mesma lógica do top produtos
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      
      // Se houver estoque positivo, usar apenas a soma dos positivos
      // Caso contrário, usar a soma dos positivos + negativos
      const estoqueFilial = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      
      // Normalizar código do produto para garantir consistência
      const produtoNormalizado = (row.produto || '').trim().toUpperCase();
      
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      
      // Chave para estoque por filial: produto|cor (normalizada)
      const estoqueKey = `${produtoNormalizado}|${corNormalizada}`;
      
      // Buscar informações do produto do produtoInfoMap para criar itens sem vendas
      // Como o estoque não tem grade, vamos buscar todas as grades possíveis para este produto+cor
      // e criar itens para cada uma que tenha informações no produtoInfoMap
      const produtoInfoKeys = Array.from(produtoInfoMap.keys()).filter(key => 
        key.startsWith(`${produtoNormalizado}|${corNormalizada}|`)
      );
      
      // Se não encontrou nenhuma informação no produtoInfoMap, criar um item com grade vazia
      if (produtoInfoKeys.length === 0) {
        const keySemGrade = `${produtoNormalizado}|${corNormalizada}|`;
        if (!itemMap.has(keySemGrade)) {
          itemMap.set(keySemGrade, {
            produto: row.produto,
            subgrupo: 'SEM SUBGRUPO',
            grupo: 'SEM GRUPO',
            grade: '',
            descricao: '',
            cor: corNormalizada,
            totalVendas: 0,
            totalEstoque: 0,
            filiais: [],
          });
        }
      } else {
        // Criar itens para cada grade encontrada no produtoInfoMap
        produtoInfoKeys.forEach(infoKey => {
          if (!itemMap.has(infoKey)) {
            const produtoInfo = produtoInfoMap.get(infoKey)!;
            itemMap.set(infoKey, {
              produto: row.produto,
              subgrupo: produtoInfo.subgrupo,
              grupo: produtoInfo.grupo,
              grade: produtoInfo.grade,
              descricao: produtoInfo.descricao,
              cor: corNormalizada,
              totalVendas: 0,
              totalEstoque: 0,
              filiais: [],
              linha: produtoInfo.linha && produtoInfo.linha !== '' ? produtoInfo.linha : undefined,
              colecao: produtoInfo.colecao && produtoInfo.colecao !== '' ? produtoInfo.colecao : undefined,
            });
          }
        });
      }
      
      if (!filiaisMap.has(estoqueKey)) {
        filiaisMap.set(estoqueKey, new Map());
      }
      
      const filiais = filiaisMap.get(estoqueKey)!;
      
      // Normalizar filial para garantir consistência
      const filialNormalizada = normalizeFilial(row.filial);
      
      if (!filiais.has(filialNormalizada)) {
        // Buscar vendas dos últimos 30 dias
        const vendasLast30Days = vendasLast30DaysMap.get(estoqueKey)?.get(filialNormalizada) ?? 0;
        
        // Verificar se houve entrada para este produto+cor+filial (usar produto normalizado)
        const entryKey = `${produtoNormalizado}|${corNormalizada}|${filialNormalizada}`;
        let hasEntry = entriesMap.get(entryKey) ?? false;
        
        // Se tem estoque, logicamente deve ter tido entrada (mesmo que a busca não encontrou)
        // Isso pode acontecer se a entrada foi feita de outra forma (transferência, ajuste, etc)
        if (estoqueFilial !== 0) {
          hasEntry = true;
        }
        
        filiais.set(filialNormalizada, {
          filial: row.filial, // Manter o nome original para exibição
          stock: 0,
          sales: 0,
          salesLast30Days: vendasLast30Days,
          hasEntry,
        });
      }

      // Atribuir estoque da filial (já calculado na query com soma de todas as grades)
      const filialData = filiais.get(filialNormalizada)!;
      filialData.stock = estoqueFilial;
      
      // Se tem estoque, garantir que hasEntry seja true
      if (estoqueFilial !== 0 && !filialData.hasEntry) {
        filialData.hasEntry = true;
      }
    });

    // Processar vendas (agrupadas por produto+cor+grade+filial)
    vendasResult.recordset.forEach((row) => {
      // Normalizar código do produto para garantir consistência
      const produtoNormalizado = (row.produto || '').trim().toUpperCase();
      
      // Usar mapeamento de cores (prioridade) ou fallback para cor do banco
      const corNormalizada = normalizeColor(
        getColorDescription(row.corProduto, row.corBanco)
      );
      
      // Normalizar grade - garantir que seja string e tratar valores nulos/vazios
      // A grade vem da query como CONVERT(VARCHAR, p.GRADE) da tabela PRODUTOS
      let gradeNormalizada = '';
      if (row.grade != null) {
        const gradeStr = String(row.grade).trim();
        // Se a grade for apenas espaços ou vazia após trim, usar string vazia
        gradeNormalizada = gradeStr || '';
      }
      
      const key = `${produtoNormalizado}|${corNormalizada}|${gradeNormalizada}`;
      
      if (!itemMap.has(key)) {
        // Buscar informações do produto do mapa (pode ter grade diferente, então usar a grade da venda)
        const produtoInfo = produtoInfoMap.get(key) || {
          subgrupo: row.subgrupo,
          grupo: (row.grupo && row.grupo.trim() !== '') ? row.grupo : 'SEM GRUPO',
          grade: gradeNormalizada,
          descricao: row.descricao,
          linha: '',
          colecao: '',
        };
        
        itemMap.set(key, {
          produto: row.produto,
          subgrupo: produtoInfo.subgrupo,
          grupo: produtoInfo.grupo,
          grade: gradeNormalizada, // Sempre usar a grade da venda atual (row.grade normalizada)
          descricao: produtoInfo.descricao,
          cor: corNormalizada, // Usar cor normalizada do mapeamento
          totalVendas: 0,
          totalEstoque: 0,
          filiais: [],
          linha: produtoInfo.linha && produtoInfo.linha !== '' ? produtoInfo.linha : undefined,
          colecao: produtoInfo.colecao && produtoInfo.colecao !== '' ? produtoInfo.colecao : undefined,
        });
      }

      const item = itemMap.get(key)!;
      const vendas = Number(row.vendas ?? 0);
      item.totalVendas += vendas;

      // Chave para estoque por filial: produto|cor (normalizada, mesma usada no estoque)
      const estoqueKey = `${produtoNormalizado}|${corNormalizada}`;
      
      if (!filiaisMap.has(estoqueKey)) {
        filiaisMap.set(estoqueKey, new Map());
      }
      
      const filiais = filiaisMap.get(estoqueKey)!;

      // Normalizar filial para garantir consistência
      const filialNormalizada = normalizeFilial(row.filial);

      if (!filiais.has(filialNormalizada)) {
        // Buscar vendas dos últimos 30 dias
        const vendasLast30Days = vendasLast30DaysMap.get(estoqueKey)?.get(filialNormalizada) ?? 0;
        
        // Verificar se houve entrada para este produto+cor+filial (usar produto normalizado)
        const entryKey = `${produtoNormalizado}|${corNormalizada}|${filialNormalizada}`;
        let hasEntry = entriesMap.get(entryKey) ?? false;
        
        // Se tem vendas, logicamente deve ter tido entrada (mesmo que a busca não encontrou)
        if (vendas > 0) {
          hasEntry = true;
        }
        
        filiais.set(filialNormalizada, {
          filial: row.filial, // Manter o nome original para exibição
          stock: 0,
          sales: 0,
          salesLast30Days: vendasLast30Days,
          hasEntry,
        });
      }

      // Acumular vendas da filial
      const filialData = filiais.get(filialNormalizada)!;
      filialData.sales += vendas;
      
      // Se tem vendas, garantir que hasEntry seja true
      if (vendas > 0 && !filialData.hasEntry) {
        filialData.hasEntry = true;
      }
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
        ${grupoFilter}
        ${linhaFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${colecaoFilter}
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
      // Normalizar código do produto para garantir consistência
      const produtoNormalizado = (row.produto || '').trim().toUpperCase();
      
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
      const key = `${produtoNormalizado}|${corNormalizada}`;
      stockTotalMap.set(key, finalStock);
    });

    // Converter para array e adicionar filiais e estoque total
    const items: StockByFilialItem[] = Array.from(itemMap.values()).map((item) => {
      // Chave para estoque por filial: produto|cor (sem grade)
      // Normalizar produto para garantir consistência
      const produtoNormalizado = (item.produto || '').trim().toUpperCase();
      // A cor já está normalizada no item (vem do mapeamento)
      const corNormalizada = normalizeColor(item.cor);
      const estoqueKey = `${produtoNormalizado}|${corNormalizada}`;
      const filiais = filiaisMap.get(estoqueKey) ?? new Map();
      item.filiais = Array.from(filiais.values());
      
      // Buscar estoque total (usar mesma normalização)
      const stockKey = `${produtoNormalizado}|${corNormalizada}`;
      item.totalEstoque = stockTotalMap.get(stockKey) ?? 0;
      
      // Garantir que grade seja sempre string
      if (typeof item.grade !== 'string') {
        item.grade = '';
      }
      
      // Garantir que linha e colecao sejam strings ou undefined
      if (item.linha && typeof item.linha !== 'string') {
        item.linha = undefined;
      }
      if (item.colecao && typeof item.colecao !== 'string') {
        item.colecao = undefined;
      }
      
      return item;
    });

    // Ordenar por total de vendas (maior para menor)
    items.sort((a, b) => b.totalVendas - a.totalVendas);

    return items;
  });
}

/**
 * Busca valores únicos de linha, subgrupo, grade e coleção para ScarfMe
 */
export async function fetchFilterOptions(
  company?: string
): Promise<{
  linhas: string[];
  subgrupos: string[];
  grades: string[];
  colecoes: string[];
}> {
  if (company !== 'scarfme') {
    return { linhas: [], subgrupos: [], grades: [], colecoes: [] };
  }

  return withRequest(async (request) => {
    const linhasQuery = `
      SELECT DISTINCT UPPER(LTRIM(RTRIM(ISNULL(LINHA, '')))) AS linha
      FROM PRODUTOS WITH (NOLOCK)
      WHERE LINHA IS NOT NULL AND LTRIM(RTRIM(LINHA)) <> ''
      ORDER BY linha
    `;

    const subgruposQuery = `
      SELECT DISTINCT UPPER(LTRIM(RTRIM(ISNULL(SUBGRUPO_PRODUTO, '')))) AS subgrupo
      FROM PRODUTOS WITH (NOLOCK)
      WHERE SUBGRUPO_PRODUTO IS NOT NULL AND LTRIM(RTRIM(SUBGRUPO_PRODUTO)) <> ''
      ORDER BY subgrupo
    `;

    const gradesQuery = `
      SELECT DISTINCT UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, GRADE), '')))) AS grade
      FROM PRODUTOS WITH (NOLOCK)
      WHERE GRADE IS NOT NULL
      ORDER BY grade
    `;

    const colecoesQuery = `
      SELECT DISTINCT UPPER(LTRIM(RTRIM(ISNULL(COLECAO, '')))) AS colecao
      FROM PRODUTOS WITH (NOLOCK)
      WHERE COLECAO IS NOT NULL AND LTRIM(RTRIM(COLECAO)) <> ''
      ORDER BY colecao
    `;

    const [linhasResult, subgruposResult, gradesResult, colecoesResult] = await Promise.all([
      request.query<{ linha: string }>(linhasQuery),
      request.query<{ subgrupo: string }>(subgruposQuery),
      request.query<{ grade: string }>(gradesQuery),
      request.query<{ colecao: string }>(colecoesQuery),
    ]);

    return {
      linhas: linhasResult.recordset.map((r) => r.linha).filter(Boolean),
      subgrupos: subgruposResult.recordset.map((r) => r.subgrupo).filter(Boolean),
      grades: gradesResult.recordset.map((r) => r.grade).filter(Boolean),
      colecoes: colecoesResult.recordset.map((r) => r.colecao).filter(Boolean),
    };
  });
}

