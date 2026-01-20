import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { getColorDescription } from '@/lib/utils/colorMapping';
import type { DateRangeInput } from '@/types/dashboard';

function resolveRange(range?: DateRangeInput) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
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

function buildVendasFilialFilter(
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

  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('vendasFilial', sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @vendasFilial`;
  }

  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`vendasFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@vendasFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  if (isScarfme && specificFilial === null) {
    const allFiliais = filiais;
    
    if (allFiliais.length === 0) {
      return '';
    }

    allFiliais.forEach((filial, index) => {
      request.input(`vendasFilial${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@vendasFilial${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`vendasFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@vendasFilial${index}`)
    .join(', ');

  return `AND ${prefix}.FILIAL IN (${placeholders})`;
}

function buildGrupoFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  grupos: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (company !== 'nerd' || !grupos || grupos.length === 0) {
    return '';
  }

  const gruposNormalizados = grupos.map(g => g.trim().toUpperCase()).filter(g => g !== '');
  if (gruposNormalizados.length === 0) {
    return '';
  }

  if (gruposNormalizados.length === 1) {
    request.input('grupo', sql.VarChar, gruposNormalizados[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(${prefix}.GRUPO_PRODUTO, '')))) = @grupo
    )`;
  }

  gruposNormalizados.forEach((g, index) => {
    request.input(`grupo${index}`, sql.VarChar, g);
  });

  const placeholders = gruposNormalizados.map((_, index) => `@grupo${index}`).join(', ');
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(${prefix}.GRUPO_PRODUTO, '')))) IN (${placeholders})
  )`;
}

function buildLinhaFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  linhas: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (company !== 'scarfme' || !linhas || linhas.length === 0) {
    return '';
  }

  const linhasNormalizadas = linhas.map(l => l.trim().toUpperCase()).filter(l => l !== '');
  if (linhasNormalizadas.length === 0) {
    return '';
  }

  if (linhasNormalizadas.length === 1) {
    request.input('linha', sql.VarChar, linhasNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) = @linha`;
  }

  linhasNormalizadas.forEach((l, index) => {
    request.input(`linha${index}`, sql.VarChar, l);
  });

  const placeholders = linhasNormalizadas.map((_, index) => `@linha${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) IN (${placeholders})`;
}

function buildColecaoFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  colecoes: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (company !== 'scarfme' || !colecoes || colecoes.length === 0) {
    return '';
  }

  const colecoesNormalizadas = colecoes.map(c => c.trim().toUpperCase()).filter(c => c !== '');
  if (colecoesNormalizadas.length === 0) {
    return '';
  }

  if (colecoesNormalizadas.length === 1) {
    request.input('colecao', sql.VarChar, colecoesNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.COLECAO, '')))) = @colecao`;
  }

  colecoesNormalizadas.forEach((c, index) => {
    request.input(`colecao${index}`, sql.VarChar, c);
  });

  const placeholders = colecoesNormalizadas.map((_, index) => `@colecao${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.COLECAO, '')))) IN (${placeholders})`;
}

function buildSubgrupoFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  subgrupos: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (company !== 'scarfme' || !subgrupos || subgrupos.length === 0) {
    return '';
  }

  const subgruposNormalizados = subgrupos.map(s => s.trim().toUpperCase()).filter(s => s !== '');
  if (subgruposNormalizados.length === 0) {
    return '';
  }

  if (subgruposNormalizados.length === 1) {
    request.input('subgrupo', sql.VarChar, subgruposNormalizados[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
  }

  subgruposNormalizados.forEach((s, index) => {
    request.input(`subgrupo${index}`, sql.VarChar, s);
  });

  const placeholders = subgruposNormalizados.map((_, index) => `@subgrupo${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})`;
}

function buildGradeFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  grades: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (company !== 'scarfme' || !grades || grades.length === 0) {
    return '';
  }

  const gradesNormalizadas = grades.map(g => g.trim().toUpperCase()).filter(g => g !== '');
  if (gradesNormalizadas.length === 0) {
    return '';
  }

  if (gradesNormalizadas.length === 1) {
    request.input('grade', sql.VarChar, gradesNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, ${prefix}.GRADE), '')))) = @grade`;
  }

  gradesNormalizadas.forEach((g, index) => {
    request.input(`grade${index}`, sql.VarChar, g);
  });

  const placeholders = gradesNormalizadas.map((_, index) => `@grade${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, ${prefix}.GRADE), '')))) IN (${placeholders})`;
}

export interface ControleEstoqueParams {
  company?: string;
  filial?: string | null;
  range?: DateRangeInput;
  periodType?: 'semanal' | 'mensal';
  grupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
}

export interface EstoqueKPI {
  estoqueTotal: number;
  valorEmEstoque: number;
  vendasEsteMes: number;
  categoriasAtivas: number;
  estoqueTotalAnterior: number;
  vendasMesAnterior: number;
}

export interface CategoriaEstoque {
  categoria: string;
  estoqueAtual: number;
  custoTotal: number;
  custoUnitario: number;
  vendasPeriodo: number; // Renomeado de vendasMes - Venda Total (período)
  duracao: number; // dias
  projecaoMes: number;
  projecaoAnual: number;
  projecaoVendasMes: number; // projeção de vendas mensal (média dos últimos meses)
  tendenciaSemanal: number; // quantidade real (diferença semanal)
  estoqueSemanaPassada: number; // estoque de uma semana atrás
  // Campos detalhados quando há filtros selecionados
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
}

export interface EvolucaoEstoqueData {
  semana: string;
  [categoria: string]: string | number;
}

export interface VendasCategoriaData {
  categoria: string;
  vendas: number;
}

export interface DetalheEntradaSemana {
  data: Date | string;
  romaneio: string;
  produto: string;
  descricao: string;
  cor: string;
  corDescricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  quantidade: number;
  filial: string;
  vendas?: number; // Vendas do produto+cor na mesma semana
}

export interface DetalheVendaSemana {
  data: Date | string;
  ticket: string;
  produto: string;
  descricao: string;
  cor: string;
  corDescricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  quantidade: number;
  filial: string;
  valorLiquido?: number;
}

export interface DetalheEcommerceSemana {
  data: Date | string;
  nf: string;
  serie: string;
  produto: string;
  descricao: string;
  cor: string;
  corDescricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  quantidade: number;
  filial: string;
  valorLiquido?: number;
}

export interface PrevisaoEstoque {
  categoria: string;
  estoqueAtual: number;
  mediaDia: number;
  duracao: number;
  prevFimMes: number;
  prevFimAno: number;
  status: 'OK' | 'ALERTA' | 'CRITICO';
}

/**
 * Busca os KPIs principais de controle de estoque
 */
export async function fetchEstoqueKPIs({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<EstoqueKPI> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };
    const previousMonth = shiftRangeByMonths(currentMonth, -1);
    
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');

    // Estoque atual
    // Para categorias ativas, usar o campo correto baseado na empresa
    const categoriaFieldKPI = company === 'nerd' 
      ? 'p.GRUPO_PRODUTO'
      : 'p.LINHA';
    
    const estoqueQuery = `
      SELECT 
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueTotal,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS valorTotal,
        COUNT(DISTINCT CASE WHEN e.ESTOQUE > 0 THEN ${categoriaFieldKPI} END) AS categoriasAtivas
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND e.ESTOQUE > 0
    `;

    const estoqueResult = await request.query<{
      estoqueTotal: number | null;
      valorTotal: number | null;
      categoriasAtivas: number | null;
    }>(estoqueQuery);

    const estoqueRow = estoqueResult.recordset[0] ?? {
      estoqueTotal: 0,
      valorTotal: 0,
      categoriasAtivas: 0,
    };

    // Vendas do mês atual
    request.input('currentStart', sql.DateTime, currentMonth.start);
    request.input('currentEnd', sql.DateTime, currentMonth.end);
    
    const vendasAtualQuery = `
      SELECT 
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasMes
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @currentStart
        AND vp.DATA_VENDA < @currentEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
    `;

    const vendasAtualResult = await request.query<{
      vendasMes: number | null;
    }>(vendasAtualQuery);

    // Vendas do mês anterior
    request.input('prevStart', sql.DateTime, previousMonth.start);
    request.input('prevEnd', sql.DateTime, previousMonth.end);
    
    const vendasAnteriorQuery = `
      SELECT 
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasMes
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @prevStart
        AND vp.DATA_VENDA < @prevEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
    `;

    const vendasAnteriorResult = await request.query<{
      vendasMes: number | null;
    }>(vendasAnteriorQuery);

    // Estoque do mês anterior (simplificado - usar mesmo estoque atual como base)
    // Em um sistema real, isso seria calculado com base em histórico
    const estoqueAnterior = Number(estoqueRow.estoqueTotal ?? 0);

    return {
      estoqueTotal: Math.round(Number(estoqueRow.estoqueTotal ?? 0)),
      valorEmEstoque: Number(estoqueRow.valorTotal ?? 0),
      vendasEsteMes: Math.round(Number(vendasAtualResult.recordset[0]?.vendasMes ?? 0)),
      categoriasAtivas: Number(estoqueRow.categoriasAtivas ?? 0),
      estoqueTotalAnterior: estoqueAnterior,
      vendasMesAnterior: Math.round(Number(vendasAnteriorResult.recordset[0]?.vendasMes ?? 0)),
    };
  });
}

/**
 * Busca dados de estoque por categoria
 */
export async function fetchEstoquePorCategoria({
  company,
  filial,
  range,
  periodType = 'semanal',
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<CategoriaEstoque[]> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1; // 1-12
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };
    
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');

    // RESOLVER PERÍODO: Usar o range selecionado pelo usuário em vez de forçar o mês atual
    const { start: periodoStart, end: periodoEnd } = resolveRange(range);

    // ============================================
    // MUDANÇA CRÍTICA 2: Vendas SEM filtro de filial
    // ============================================
    // Construir filtro que INCLUI TODAS as filiais (físicas + ecommerce)
    // para garantir que não perdemos vendas no cálculo de "Vendas Totais (período)"
    let vendasGlobaisFilter = '';
    if (company) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        // Unir filiais de venda e filiais de ecommerce em um único conjunto
        const todasFiliais = new Set([
          ...(companyConfig.filialFilters['sales'] ?? []),
          ...(companyConfig.ecommerceFilials ?? [])
        ]);

        if (todasFiliais.size > 0) {
           const filiaisArray = Array.from(todasFiliais);
           filiaisArray.forEach((f, i) => request.input(`vendaGlobalFilial${i}`, sql.VarChar, f));
           const placeholders = filiaisArray.map((_, i) => `@vendaGlobalFilial${i}`).join(', ');
           vendasGlobaisFilter = `AND vp.FILIAL IN (${placeholders})`;
        }
      }
    }

    // ============================================
    // MUDANÇA CRÍTICA 1: SEMPRE retornar detalhes
    // ============================================
    // SEMPRE retornar dados no nível mais granular (Linha + Subgrupo + Grade + Coleção)
    // para permitir expansão no frontend sem precisar fazer novas queries
    // Determinar campo de categoria baseado na empresa
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // SEMPRE incluir campos detalhados para permitir expansão no frontend
    const camposAdicionais = `, ISNULL(p.LINHA, '') AS linha, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`;
    const groupByAdicional = `, ISNULL(p.LINHA, ''), ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`;

    // Campos adicionais para queries de vendas (mesmo que camposAdicionais, mas para queries de vendas)
    const camposVendasAdicionais = camposAdicionais;
    const groupByVendasAdicional = groupByAdicional;

    // Estoque por categoria (com detalhes se necessário)
    const estoqueQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposAdicionais},
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueAtual,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByAdicional}
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    `;

    const estoqueResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      estoqueAtual: number | null;
      custoTotal: number | null;
    }>(estoqueQuery);

    // QUERY DE VENDAS REFEITA
    // - Usa o período selecionado (periodoStart/End)
    // - Usa o filtro inclusivo (vendasTotalFilter) para incluir todas as filiais (físicas + ecommerce)
    // - Agrupa por ano/mês também para permitir cálculos de projeção se necessário
    const hoje = new Date(now.getTime());
    hoje.setHours(23, 59, 59, 999); // Fim do dia de hoje

    const vendasMensaisQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposVendasAdicionais},
        YEAR(vp.DATA_VENDA) AS ano,
        MONTH(vp.DATA_VENDA) AS mes,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStart
        AND vp.DATA_VENDA < @periodoEnd
        AND vp.QTDE > 0
        ${vendasGlobaisFilter} 
        ${grupoFilter}
        -- NÃO aplicar linhaFilter, colecaoFilter, subgrupoFilter, gradeFilter aqui
        -- para não perder vendas que pertencem à categoria
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByVendasAdicional}, YEAR(vp.DATA_VENDA), MONTH(vp.DATA_VENDA)
    `;

    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);
    request.input('currentMonthStart', sql.DateTime, currentMonth.start);
    request.input('hoje', sql.DateTime, hoje);

    const vendasMensaisResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      ano: number;
      mes: number;
      vendas: number | null;
    }>(vendasMensaisQuery);

    // Buscar vendas de e-commerce do período (apenas para ScarfMe)
    // IMPORTANTE: Incluir e-commerce na "Venda Total (período)"
    let ecommercePeriodoResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; ano: number; mes: number; vendas: number | null }> } = { recordset: [] };
    if (company === 'scarfme') {
      // Criar filtro de filial para e-commerce que inclua todas as filiais de e-commerce
      let ecommercePeriodoFilialFilter = '';
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
        if (ecommerceFilials.length > 0) {
          ecommerceFilials.forEach((f, index) => {
            request.input(`ecommercePeriodoFilial${index}`, sql.VarChar, f);
          });
          const placeholders = ecommerceFilials.map((_, i) => `@ecommercePeriodoFilial${i}`).join(', ');
          ecommercePeriodoFilialFilter = `AND f.FILIAL IN (${placeholders})`;
        }
      }

      const ecommercePeriodoQuery = `
        SELECT 
          ${categoriaField} AS categoria
          ${camposVendasAdicionais},
          YEAR(f.EMISSAO) AS ano,
          MONTH(f.EMISSAO) AS mes,
          SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE f.EMISSAO >= @periodoStart
          AND f.EMISSAO < @periodoEnd
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND CAST(fp.QTDE AS FLOAT) > 0
          ${ecommercePeriodoFilialFilter}
          ${grupoFilter}
          -- NÃO aplicar linhaFilter, colecaoFilter, subgrupoFilter, gradeFilter aqui
          -- para não perder vendas que pertencem à categoria
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
        GROUP BY ${categoriaField}${groupByVendasAdicional}, YEAR(f.EMISSAO), MONTH(f.EMISSAO)
      `;

      ecommercePeriodoResult = await request.query<{
        categoria: string;
        linha?: string;
        subgrupo?: string;
        grade?: string;
        colecao?: string;
        ano: number;
        mes: number;
        vendas: number | null;
      }>(ecommercePeriodoQuery);
    }

    // ============================================
    // PROCESSAMENTO: Agrupar vendas por chave detalhada
    // ============================================
    // SEMPRE usar chave detalhada (categoria|linha|subgrupo|grade|colecao)
    const vendasPorCategoriaTotal = new Map<string, number>();
    const vendasPorCategoriaMesAtual = new Map<string, number>();

    // Processar vendas físicas
    vendasMensaisResult.recordset.forEach((row: any) => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chave = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;

      const qtd = Number(row.vendas || 0);

      // Somar ao total do período (Venda Total)
      const totalAtual = vendasPorCategoriaTotal.get(chave) || 0;
      vendasPorCategoriaTotal.set(chave, totalAtual + qtd);

      // Verificar se pertence ao mês atual (para projeção)
      if (row.ano === currentYear && row.mes === currentMonthNum) {
        const mesAtual = vendasPorCategoriaMesAtual.get(chave) || 0;
        vendasPorCategoriaMesAtual.set(chave, mesAtual + qtd);
      }
    });

    // Processar vendas de e-commerce e somar ao total
    ecommercePeriodoResult.recordset.forEach((row: any) => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chave = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;

      const qtd = Number(row.vendas || 0);

      // Somar ao total do período (Venda Total) - INCLUINDO E-COMMERCE
      const totalAtual = vendasPorCategoriaTotal.get(chave) || 0;
      vendasPorCategoriaTotal.set(chave, totalAtual + qtd);

      // Verificar se pertence ao mês atual (para projeção)
      if (row.ano === currentYear && row.mes === currentMonthNum) {
        const mesAtual = vendasPorCategoriaMesAtual.get(chave) || 0;
        vendasPorCategoriaMesAtual.set(chave, mesAtual + qtd);
      }
    });

    // Calcular período anterior com a mesma duração (para outras queries que ainda usam)
    // Nota: periodoStart e periodoEnd já foram calculados no início da função e declarados como inputs acima
    const duracaoPeriodo = periodoEnd.getTime() - periodoStart.getTime();
    const periodoAnteriorEnd = new Date(periodoStart.getTime() - 1); // Um dia antes do início do período atual
    const periodoAnteriorStart = new Date(periodoAnteriorEnd.getTime() - duracaoPeriodo);
    
    // Declarar apenas os parâmetros do período anterior (periodoStart e periodoEnd já foram declarados acima)
    request.input('periodoAnteriorStart', sql.DateTime, periodoAnteriorStart);
    request.input('periodoAnteriorEnd', sql.DateTime, periodoAnteriorEnd);

    // Criar filtros separados para query de entradas (usar prefixo 'pr')
    // Nota: Como os filtros já foram criados com 'p', vamos reutilizar os mesmos parâmetros SQL
    // mas ajustar o prefixo da tabela na string do filtro
    const grupoFilterEntradas = grupoFilter ? grupoFilter.replace(/p\./g, 'pr.') : '';
    const linhaFilterEntradas = linhaFilter ? linhaFilter.replace(/p\./g, 'pr.') : '';
    const colecaoFilterEntradas = colecaoFilter ? colecaoFilter.replace(/p\./g, 'pr.') : '';
    const subgrupoFilterEntradas = subgrupoFilter ? subgrupoFilter.replace(/p\./g, 'pr.') : '';
    const gradeFilterEntradas = gradeFilter ? gradeFilter.replace(/p\./g, 'pr.') : '';

    // Campos adicionais para query de entradas (usar alias 'pr' ao invés de 'p')
    // SEMPRE incluir campos detalhados
    const camposEntradasAdicionais = `, ISNULL(pr.LINHA, '') AS linha, ISNULL(pr.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, pr.GRADE), '') AS grade, ISNULL(pr.COLECAO, '') AS colecao`;
    const groupByEntradasAdicional = `, ISNULL(pr.LINHA, ''), ISNULL(pr.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, pr.GRADE), ''), ISNULL(pr.COLECAO, '')`;

    // Ajustar categoriaField para usar alias 'pr' nas queries de entradas
    const categoriaFieldEntradas = company === 'nerd' 
      ? 'ISNULL(pr.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(pr.LINHA, \'SEM LINHA\')';

    // Identificar filiais matriz para considerar apenas entradas reais (compras)
    // As principais entradas sempre são na matriz, transferências para lojas não devem contar
    let matrizFilialFilter = '';
    const companyConfig = resolveCompany(company);
    if (companyConfig) {
      // Identificar matriz baseada na empresa
      let matrizFiliais: string[] = [];
      if (company === 'scarfme') {
        // Para SCARFME, a matriz é apenas "SCARF ME - MATRIZ"
        matrizFiliais = ['SCARF ME - MATRIZ'];
      } else if (company === 'nerd') {
        // Para NERD, a matriz é simplesmente "NERD"
        matrizFiliais = ['NERD'];
      }

      // Se há filial específica selecionada E não é matriz, não contar entradas
      // (porque isso seria uma visão de filial específica, não do total)
      if (filial && filial !== VAREJO_VALUE && !matrizFiliais.includes(filial)) {
        // Se filial específica não é matriz, usar filtro de filial (mas não há entradas reais lá)
        // Manter o entradasFilialFilter existente, mas ainda precisamos filtrar apenas matriz
        // Na verdade, para histórico correto, SEMPRE contar apenas entradas da matriz
        // independente do filtro de filial, porque entradas reais só acontecem na matriz
      }

      // Sempre filtrar entradas apenas na matriz para cálculo correto de histórico
      // Transferências para lojas não são entradas reais, são apenas movimentações internas
      if (matrizFiliais.length > 0) {
        matrizFiliais.forEach((filialMatriz, index) => {
          request.input(`matrizFilial${index}`, sql.VarChar, filialMatriz);
        });
        const placeholders = matrizFiliais.map((_, i) => `@matrizFilial${i}`).join(', ');
        matrizFilialFilter = `AND E.FILIAL IN (${placeholders})`;
      }
    }

    // Criar filtro para excluir filiais matriz/ecommerce das saídas
    // Queremos verificar se houve saída de LOJA (não matriz) no mesmo dia
    let lojasFilterSaidas = '';
    if (companyConfig) {
      const filiais = companyConfig.filialFilters['inventory'] ?? [];
      const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
      // Filtrar apenas filiais que NÃO são matriz nem ecommerce
      const lojasNormais = filiais.filter(f => {
        if (company === 'scarfme') {
          return f !== 'SCARF ME - MATRIZ' && !ecommerceFilials.includes(f);
        } else if (company === 'nerd') {
          return f !== 'NERD';
        }
        return true;
      });
      
      if (lojasNormais.length > 0) {
        lojasNormais.forEach((filialLoja, index) => {
          request.input(`lojaSaida${index}`, sql.VarChar, filialLoja);
        });
        const placeholders = lojasNormais.map((_, i) => `@lojaSaida${i}`).join(', ');
        lojasFilterSaidas = `AND S.FILIAL IN (${placeholders})`;
      }
    }

    // Buscar entradas dos últimos 7 dias
    // IMPORTANTE: Considerar apenas entradas na matriz que NÃO são devoluções/transferências
    // Regra: Se um produto SAIU de uma loja no mesmo dia que ENTROU na matriz, é devolução (não conta)
    // Apenas entradas na matriz SEM saída correspondente de loja são compras reais
    const entradasSemanaQuery = `
      SELECT 
        ${categoriaFieldEntradas} AS categoria
        ${camposEntradasAdicionais},
        SUM(CAST(P.QTDE AS FLOAT)) AS entradas
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @periodoStart
        AND E.EMISSAO < @periodoEnd
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        AND ${categoriaFieldEntradas} <> ''
        AND ${categoriaFieldEntradas} <> 'SEM GRUPO'
        AND ${categoriaFieldEntradas} <> 'SEM LINHA'
        -- EXCLUIR devoluções/transferências: se houve saída de LOJA (não matriz) no mesmo dia com mesmo produto+cor, é devolução
        AND NOT EXISTS (
          SELECT 1
          FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
          WHERE PS.PRODUTO = P.PRODUTO
            AND ISNULL(PS.COR_PRODUTO, '') = ISNULL(P.COR_PRODUTO, '')
            AND CAST(S.EMISSAO AS DATE) = CAST(E.EMISSAO AS DATE)
            ${lojasFilterSaidas}
        )
      GROUP BY ${categoriaFieldEntradas}${groupByEntradasAdicional}
    `;

    const entradasSemanaResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      entradas: number | null;
    }>(entradasSemanaQuery);

    // Buscar vendas dos últimos 7 dias (já usa vendasFilialFilter que foi criado anteriormente)
    const vendasSemanaQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposVendasAdicionais},
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStart
        AND vp.DATA_VENDA < @periodoEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByVendasAdicional}
    `;

    const vendasSemanaResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendas: number | null;
    }>(vendasSemanaQuery);

    // Criar filtro de filial para e-commerce com a mesma lógica do buildFilialFilter
    // Mas com nomes de parâmetros únicos para evitar conflitos (EDUPEPARAM)
    let ecommerceFilialFilter = '';
    if (company === 'scarfme') {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const isScarfme = company === 'scarfme';
        const filiais = companyConfig.filialFilters['inventory'] ?? [];
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

        // Se uma filial específica foi selecionada, usar apenas ela
        if (filial && filial !== VAREJO_VALUE) {
          request.input('ecommerceSemanaFilial', sql.VarChar, filial);
          ecommerceFilialFilter = `AND f.FILIAL = @ecommerceSemanaFilial`;
        }
        // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
        else if (isScarfme && filial === VAREJO_VALUE) {
          const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
          if (normalFiliais.length > 0) {
            normalFiliais.forEach((f, index) => {
              request.input(`ecommerceSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = normalFiliais.map((_, i) => `@ecommerceSemanaFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        }
        // Para scarfme: se for "Todas as filiais" (null), incluir também ecommerce
        else if (isScarfme && filial === null) {
          if (filiais.length > 0) {
            filiais.forEach((f, index) => {
              request.input(`ecommerceSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = filiais.map((_, i) => `@ecommerceSemanaFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        }
        // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
        else {
          const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
          if (normalFiliais.length > 0) {
            normalFiliais.forEach((f, index) => {
              request.input(`ecommerceSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = normalFiliais.map((_, i) => `@ecommerceSemanaFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        }
      }
    }

    // Campos adicionais para query de e-commerce (usar alias 'p' - mesmo que vendas)
    // categoriaField também usa 'p', então está correto

    // Buscar e-commerce dos últimos 7 dias (apenas para ScarfMe)
    let ecommerceSemanaResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; ecommerce: number | null }> } = { recordset: [] };
    if (company === 'scarfme') {
      const ecommerceSemanaQuery = `
        SELECT 
          ${categoriaField} AS categoria
          ${camposVendasAdicionais},
          SUM(CAST(fp.QTDE AS FLOAT)) AS ecommerce
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE f.EMISSAO >= @periodoStart
          AND f.EMISSAO < @periodoEnd
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND CAST(fp.QTDE AS FLOAT) > 0
          ${ecommerceFilialFilter}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
        GROUP BY ${categoriaField}${groupByVendasAdicional}
      `;

      ecommerceSemanaResult = await request.query<{
        categoria: string;
        linha?: string;
        subgrupo?: string;
        grade?: string;
        colecao?: string;
        ecommerce: number | null;
      }>(ecommerceSemanaQuery);
    }

    // Agrupar movimentações por categoria
    const entradasSemanaMap = new Map<string, number>();
    entradasSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      entradasSemanaMap.set(chaveCategoria, Number(row.entradas ?? 0));
    });

    const vendasSemanaMap = new Map<string, number>();
    vendasSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      vendasSemanaMap.set(chaveCategoria, Number(row.vendas ?? 0));
    });

    const ecommerceSemanaMap = new Map<string, number>();
    ecommerceSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      ecommerceSemanaMap.set(chaveCategoria, Number(row.ecommerce ?? 0));
    });

    // Vendas da semana/mês anterior para calcular tendência
    // currentMonth já está definido no início da função
    const previousMonth = shiftRangeByMonths(currentMonth, -1);
    
    const periodStart = periodType === 'semanal' 
      ? new Date(currentMonth.start.getTime() - 7 * 24 * 60 * 60 * 1000)
      : previousMonth.start;
    const periodEnd = periodType === 'semanal'
      ? currentMonth.start
      : previousMonth.end;

    request.input('periodStart', sql.DateTime, periodStart);
    request.input('periodEnd', sql.DateTime, periodEnd);
    
    const vendasPeriodoAnteriorQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposVendasAdicionais},
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasPeriodo
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodStart
        AND vp.DATA_VENDA < @periodEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByVendasAdicional}
    `;

    const vendasPeriodoAnteriorResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendasPeriodo: number | null;
    }>(vendasPeriodoAnteriorQuery);

    const vendasPeriodoAnteriorMap = new Map<string, number>();
    vendasPeriodoAnteriorResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      vendasPeriodoAnteriorMap.set(chaveCategoria, Number(row.vendasPeriodo ?? 0));
    });

    // ============================================
    // IMPORTANTE: Criar lista de TODAS as categorias que aparecem nas VENDAS
    // (não apenas no estoque), para não perder vendas de produtos sem estoque
    // ============================================
    const categoriasUnicasVendas = new Map<string, { categoria: string; linha: string; subgrupo: string; grade: string; colecao: string }>();
    
    // Adicionar todas as categorias que aparecem nas vendas físicas
    vendasMensaisResult.recordset.forEach((row: any) => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      
      if (!categoriasUnicasVendas.has(chave)) {
        categoriasUnicasVendas.set(chave, { categoria, linha, subgrupo, grade, colecao });
      }
    });
    
    // Adicionar todas as categorias que aparecem no e-commerce
    ecommercePeriodoResult.recordset.forEach((row: any) => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      
      if (!categoriasUnicasVendas.has(chave)) {
        categoriasUnicasVendas.set(chave, { categoria, linha, subgrupo, grade, colecao });
      }
    });
    
    // Adicionar também categorias que aparecem no estoque (caso não tenham vendas)
    estoqueResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      
      if (!categoriasUnicasVendas.has(chave)) {
        categoriasUnicasVendas.set(chave, { categoria, linha, subgrupo, grade, colecao });
      }
    });
    
    // Criar um mapa de estoque por chave
    const estoquePorChave = new Map<string, { estoqueAtual: number; custoTotal: number }>();
    estoqueResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      
      estoquePorChave.set(chave, {
        estoqueAtual: Number(row.estoqueAtual ?? 0),
        custoTotal: Number(row.custoTotal ?? 0),
      });
    });
    
    // Processar resultados: criar lista baseada em TODAS as categorias (vendas + estoque)
    const categorias: CategoriaEstoque[] = Array.from(categoriasUnicasVendas.values()).map(detalhes => {
      const categoria = detalhes.categoria;
      const linha = detalhes.linha;
      const subgrupo = detalhes.subgrupo;
      const grade = detalhes.grade;
      const colecao = detalhes.colecao;
      
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      
      // Buscar estoque (pode ser 0 se não houver estoque)
      const estoqueInfo = estoquePorChave.get(chaveCategoria) || {
        estoqueAtual: 0,
        custoTotal: 0,
      };
      
      const estoqueAtual = estoqueInfo.estoqueAtual;
      const custoTotal = estoqueInfo.custoTotal;
      const custoUnitario = 0; // Não aplicável para categorias agregadas
      
      // RECUPERAR VALORES CALCULADOS
      const vendasPeriodo = vendasPorCategoriaTotal.get(chaveCategoria) || 0; // Venda Total (Período)
      const vendasMesAtual = vendasPorCategoriaMesAtual.get(chaveCategoria) || 0; // Apenas para projeção

      // Cálculos de Projeção (mantidos baseados no mês atual para consistência)
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const currentDay = now.getDate();
      
      // Projeção baseada na performance do mês ATUAL
      const projecaoMensal = currentDay > 0 
        ? Math.round((vendasMesAtual / currentDay) * daysInMonth) 
        : 0;
        
      const projecaoAnual = projecaoMensal * 12;
      
      // Duração do estoque baseada na projeção mensal
      const diasEstoque = projecaoMensal > 0 
        ? Math.round((estoqueAtual / projecaoMensal) * 30) 
        : 999;

      // Calcular Estoque Final Mês = Estoque - Projeção Mensal
      const estoqueFinalMes = Math.round(estoqueAtual - projecaoMensal);

      // Calcular Estoque Final Ano = Estoque - Projeção Ano
      const estoqueFinalAno = Math.round(estoqueAtual - projecaoAnual);

      // Calcular estoque da semana passada
      // IMPORTANTE: entradasSemana agora contém apenas entradas na matriz (compras reais)
      // Transferências para lojas são movimentações internas e não alteram o estoque total
      // Estoque Semana Passada = Estoque Atual - Entradas na Matriz (7 dias) + Vendas (7 dias) + E-commerce (7 dias)
      const entradasSemana = entradasSemanaMap.get(chaveCategoria) || 0; // Apenas entradas na matriz (compras reais)
      const vendasSemana = vendasSemanaMap.get(chaveCategoria) || 0;
      const ecommerceSemana = ecommerceSemanaMap.get(chaveCategoria) || 0;
      
      // Vendas e e-commerce realmente reduzem o estoque total
      // Entradas na matriz aumentam o estoque total (são compras reais)
      // Transferências não são consideradas aqui (já filtradas na query de entradas)
      const estoquePeriodoAnterior = Math.max(0, Math.round(
        estoqueAtual - entradasSemana + vendasSemana + ecommerceSemana
      ));

      // Calcular diferença do período (quantidade real, não percentual)
      const diferencaPeriodo = Math.round(estoqueAtual - estoquePeriodoAnterior);

      return {
        categoria,
        estoqueAtual: Math.round(estoqueAtual),
        custoTotal,
        custoUnitario,
        vendasPeriodo: Math.round(vendasPeriodo), // Campo novo com valor total do período
        duracao: diasEstoque,
        projecaoMes: estoqueFinalMes, // Estoque Final Mês
        projecaoAnual: estoqueFinalAno, // Estoque Final Ano
        projecaoVendasMes: Math.round(projecaoMensal), // Projeção de vendas mensal
        tendenciaSemanal: diferencaPeriodo, // Diferença em quantidade real
        estoqueSemanaPassada: estoquePeriodoAnterior,
        // SEMPRE retornar campos detalhados
        linha: linha || undefined,
        subgrupo: subgrupo || undefined,
        grade: grade || undefined,
        colecao: colecao || undefined,
      };
    });
    
    // Filtrar apenas categorias que têm estoque OU vendas (para não mostrar categorias vazias)
    const categoriasFiltradas = categorias.filter(cat => 
      cat.estoqueAtual > 0 || cat.vendasPeriodo > 0
    );

    return categoriasFiltradas.sort((a, b) => b.estoqueAtual - a.estoqueAtual);
  });
}

/**
 * Busca dados de evolução semanal do estoque
 */
export async function fetchEvolucaoEstoque({
  company,
  filial,
  periodType = 'semanal',
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<EvolucaoEstoqueData[]> {
  return withRequest(async (request) => {
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // Buscar categorias principais
    const categoriasQuery = `
      SELECT TOP 5
        ${categoriaField} AS categoria,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
      ORDER BY estoqueTotal DESC
    `;

    const categoriasResult = await request.query<{
      categoria: string;
      estoqueTotal: number | null;
    }>(categoriasQuery);

    const categorias = categoriasResult.recordset.map(row => row.categoria?.trim() || '').filter(c => c);

    if (categorias.length === 0) {
      return [];
    }

    // Para simplificar, vamos usar o estoque atual como base para todas as semanas
    // Em um sistema real, isso seria calculado com base em histórico
    const semanas = periodType === 'semanal' 
      ? ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
      : ['Mês 1', 'Mês 2', 'Mês 3', 'Mês 4'];

    const data: EvolucaoEstoqueData[] = semanas.map(semana => {
      const row: EvolucaoEstoqueData = { semana };
      categorias.forEach(categoria => {
        // Buscar estoque atual da categoria (simplificado)
        const categoriaRow = categoriasResult.recordset.find(r => (r.categoria?.trim() || '') === categoria);
        const estoqueBase = Number(categoriaRow?.estoqueTotal ?? 0);
        // Aplicar variação aleatória pequena para simular evolução
        const variacao = 1 + (Math.random() * 0.1 - 0.05); // ±5%
        row[categoria] = Math.round(estoqueBase * variacao);
      });
      return row;
    });

    return data;
  });
}

/**
 * Busca detalhes das entradas da semana para uma categoria específica
 * Retorna lista detalhada de produtos que entraram na matriz (compras reais, sem devoluções)
 */
export async function fetchDetalhesEntradasSemana({
  company,
  filial,
  categoria,
  linha,
  subgrupo,
  grade,
  colecao,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
  range,
}: {
  company?: string;
  filial?: string | null;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  range?: { start?: Date | string; end?: Date | string };
}): Promise<DetalheEntradaSemana[]> {
  return withRequest(async (request) => {
    // Calcular período baseado no range selecionado
    // Usar normalizeRangeForQuery para garantir tratamento correto de timezone e inclusão do último dia
    const normalizedRange = normalizeRangeForQuery(range);
    const periodoStart = normalizedRange.start;
    const periodoEnd = normalizedRange.end;
    
    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    const companyConfig = resolveCompany(company);
    
    // Identificar matriz
    let matrizFiliais: string[] = [];
    if (company === 'scarfme') {
      matrizFiliais = ['SCARF ME - MATRIZ'];
    } else if (company === 'nerd') {
      matrizFiliais = ['NERD'];
    }
    
    let matrizFilialFilter = '';
    if (matrizFiliais.length > 0) {
      matrizFiliais.forEach((filialMatriz, index) => {
        request.input(`matrizFilial${index}`, sql.VarChar, filialMatriz);
      });
      const placeholders = matrizFiliais.map((_, i) => `@matrizFilial${i}`).join(', ');
      matrizFilialFilter = `AND E.FILIAL IN (${placeholders})`;
    }

    // Criar filtros de categoria
    // Usar alias 'prd' que é usado na query
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(prd.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(prd.LINHA, \'SEM LINHA\')';
    
    let categoriaFilter = '';
    const categoriaNormalizada = categoria.trim();
    request.input('categoria', sql.VarChar, categoriaNormalizada);
    
    // Se categoria é grupo (NERD) ou linha (SCARFME), usar campo apropriado
    // Usar TRIM para garantir que espaços não causem problemas
    if (company === 'nerd') {
      categoriaFilter = `AND LTRIM(RTRIM(ISNULL(prd.GRUPO_PRODUTO, 'SEM GRUPO'))) = @categoria`;
    } else {
      categoriaFilter = `AND LTRIM(RTRIM(ISNULL(prd.LINHA, 'SEM LINHA'))) = @categoria`;
    }

    // Filtros adicionais (linha, subgrupo, grade, colecao) - usar alias 'prd' da query
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'prd');
    const linhaFilter = buildLinhaFilter(request, company, linhas || (linha ? [linha] : []), 'prd');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes || (colecao ? [colecao] : []), 'prd');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos || (subgrupo ? [subgrupo] : []), 'prd');
    const gradeFilter = buildGradeFilter(request, company, grades || (grade ? [grade] : []), 'prd');

    // Criar filtro para excluir devoluções (lojas normais, não matriz/ecommerce)
    let lojasFilterSaidas = '';
    if (companyConfig) {
      const filiais = companyConfig.filialFilters['inventory'] ?? [];
      const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
      const lojasNormais = filiais.filter(f => {
        if (company === 'scarfme') {
          return f !== 'SCARF ME - MATRIZ' && !ecommerceFilials.includes(f);
        } else if (company === 'nerd') {
          return f !== 'NERD';
        }
        return true;
      });
      
      if (lojasNormais.length > 0) {
        lojasNormais.forEach((filialLoja, index) => {
          request.input(`lojaSaida${index}`, sql.VarChar, filialLoja);
        });
        const placeholders = lojasNormais.map((_, i) => `@lojaSaida${i}`).join(', ');
        lojasFilterSaidas = `AND S.FILIAL IN (${placeholders})`;
      }
    }

    // Buscar entradas detalhadas
    const query = `
      SELECT 
        E.EMISSAO AS data,
        E.ROMANEIO_PRODUTO AS romaneio,
        P.PRODUTO AS produto,
        ISNULL(prd.DESC_PRODUTO, '') AS descricao,
        ISNULL(P.COR_PRODUTO, '') AS cor,
        ISNULL(c.DESC_COR, '') AS corDescricao,
        ISNULL(prd.LINHA, '') AS linha,
        ISNULL(prd.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, prd.GRADE), '') AS grade,
        ISNULL(prd.COLECAO, '') AS colecao,
        CAST(P.QTDE AS FLOAT) AS quantidade,
        E.FILIAL AS filial
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = P.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = P.COR_PRODUTO
      WHERE prd.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @periodoStart
        AND E.EMISSAO < @periodoEnd
        ${matrizFilialFilter}
        ${categoriaFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        -- EXCLUIR devoluções
        AND NOT EXISTS (
          SELECT 1
          FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
          WHERE PS.PRODUTO = P.PRODUTO
            AND ISNULL(PS.COR_PRODUTO, '') = ISNULL(P.COR_PRODUTO, '')
            AND CAST(S.EMISSAO AS DATE) = CAST(E.EMISSAO AS DATE)
            ${lojasFilterSaidas}
        )
      ORDER BY E.EMISSAO DESC, prd.DESC_PRODUTO, P.COR_PRODUTO
    `;

    const result = await request.query<{
      data: Date;
      romaneio: string;
      produto: string;
      descricao: string;
      cor: string;
      corDescricao: string;
      linha: string | null;
      subgrupo: string | null;
      grade: string | null;
      colecao: string | null;
      quantidade: number | null;
      filial: string;
    }>(query);

    // Buscar vendas para cada produto+cor na semana
    const produtosCores = new Map<string, number>();
    result.recordset.forEach(row => {
      const chave = `${row.produto}|${row.cor}`;
      produtosCores.set(chave, 0);
    });

    if (produtosCores.size > 0) {
      // Criar placeholders para produtos e cores
      const produtosUnicos = Array.from(new Set(result.recordset.map(r => r.produto)));
      const coresUnicas = Array.from(new Set(result.recordset.map(r => r.cor).filter(c => c)));

      produtosUnicos.forEach((produto, index) => {
        request.input(`produtoVenda${index}`, sql.VarChar, produto);
      });
      coresUnicas.forEach((cor, index) => {
        request.input(`corVenda${index}`, sql.VarChar, cor);
      });

      const produtoPlaceholders = produtosUnicos.map((_, i) => `@produtoVenda${i}`).join(', ');
      const corPlaceholders = coresUnicas.length > 0 
        ? coresUnicas.map((_, i) => `@corVenda${i}`).join(', ')
        : '';

      const vendasFilialFilter = buildFilialFilter(request, company, filial, 'vp');
      
      const vendasQuery = `
        SELECT 
          vp.PRODUTO,
          ISNULL(vp.COR_PRODUTO, '') AS cor,
          SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @periodoStart
        AND vp.DATA_VENDA < @periodoEnd
          AND vp.QTDE > 0
          AND vp.PRODUTO IN (${produtoPlaceholders})
          ${corPlaceholders ? `AND ISNULL(vp.COR_PRODUTO, '') IN (${corPlaceholders})` : ''}
          ${vendasFilialFilter}
        GROUP BY vp.PRODUTO, ISNULL(vp.COR_PRODUTO, '')
      `;

      const vendasResult = await request.query<{
        PRODUTO: string;
        cor: string;
        vendas: number | null;
      }>(vendasQuery);

      vendasResult.recordset.forEach(row => {
        const chave = `${row.PRODUTO}|${row.cor}`;
        produtosCores.set(chave, Number(row.vendas ?? 0));
      });
    }

    // Montar resultado final
    return result.recordset.map(row => {
      const chave = `${row.produto}|${row.cor}`;
      const vendas = produtosCores.get(chave) || 0;

      return {
        data: row.data,
        romaneio: row.romaneio || '',
        produto: row.produto || '',
        descricao: row.descricao || '',
        cor: row.cor || '',
        corDescricao: row.corDescricao || '',
        linha: row.linha || undefined,
        subgrupo: row.subgrupo || undefined,
        grade: row.grade || undefined,
        colecao: row.colecao || undefined,
        quantidade: Number(row.quantidade ?? 0),
        filial: row.filial || '',
        vendas,
      };
    });
  });
}

/**
 * Busca detalhes das vendas da semana para uma categoria específica
 * Retorna lista detalhada de produtos vendidos na semana
 */
export async function fetchDetalhesVendasSemana({
  company,
  filial,
  categoria,
  linha,
  subgrupo,
  grade,
  colecao,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
  range,
}: {
  company?: string;
  filial?: string | null;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  range?: { start?: Date | string; end?: Date | string };
}): Promise<DetalheVendaSemana[]> {
  return withRequest(async (request) => {
    // Calcular período baseado no range selecionado
    // Usar normalizeRangeForQuery para garantir tratamento correto de timezone e inclusão do último dia
    const normalizedRange = normalizeRangeForQuery(range);
    const periodoStart = normalizedRange.start;
    const periodoEnd = normalizedRange.end;
    
    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    // Criar filtros de categoria
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';
    
    // Usar TRIM para garantir que espaços não causem problemas
    const categoriaNormalizada = categoria.trim();
    request.input('categoria', sql.VarChar, categoriaNormalizada);
    
    let categoriaFilter = '';
    if (company === 'nerd') {
      categoriaFilter = `AND LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO'))) = @categoria`;
    } else {
      categoriaFilter = `AND LTRIM(RTRIM(ISNULL(p.LINHA, 'SEM LINHA'))) = @categoria`;
    }

    // Filtros adicionais
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas || (linha ? [linha] : []), 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes || (colecao ? [colecao] : []), 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos || (subgrupo ? [subgrupo] : []), 'p');
    const gradeFilter = buildGradeFilter(request, company, grades || (grade ? [grade] : []), 'p');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');

    // Filtro de filial para e-commerce (apenas ScarfMe)
    let ecommerceFilialFilter = '';
    if (company === 'scarfme') {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const filiais = companyConfig.filialFilters['inventory'] ?? [];
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

        if (filial && filial !== VAREJO_VALUE) {
          request.input('ecommerceDetalheFilial', sql.VarChar, filial);
          ecommerceFilialFilter = `AND f.FILIAL = @ecommerceDetalheFilial`;
        } else if (filial === null) {
          // Todas as filiais (incluindo e-commerce)
          if (filiais.length > 0) {
            filiais.forEach((f, index) => {
              request.input(`ecommerceDetalheFilial${index}`, sql.VarChar, f);
            });
            const placeholders = filiais.map((_, i) => `@ecommerceDetalheFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        } else {
          // Apenas e-commerce quando filial é VAREJO ou undefined
          if (ecommerceFilials.length > 0) {
            ecommerceFilials.forEach((f, index) => {
              request.input(`ecommerceDetalheFilial${index}`, sql.VarChar, f);
            });
            const placeholders = ecommerceFilials.map((_, i) => `@ecommerceDetalheFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        }
      }
    }

    // Buscar vendas detalhadas (normais + e-commerce)
    const query = `
      -- Vendas normais (loja)
      SELECT 
        vp.DATA_VENDA AS data,
        vp.TICKET AS ticket,
        vp.PRODUTO AS produto,
        ISNULL(vp.DESC_PRODUTO, '') AS descricao,
        ISNULL(vp.COR_PRODUTO, '') AS cor,
        ISNULL(c.DESC_COR, '') AS corDescricao,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END AS quantidade,
        vp.FILIAL AS filial,
        CASE 
          WHEN vp.QTDE_CANCELADA = 0 THEN 
            (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          ELSE 0
        END AS valorLiquido
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = vp.COR_PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStart
        AND vp.DATA_VENDA < @periodoEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${categoriaFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      
      ${company === 'scarfme' ? `
      UNION ALL
      
      -- Vendas de e-commerce
      SELECT 
        f.EMISSAO AS data,
        CONCAT(f.NF_SAIDA, '-', f.SERIE_NF) AS ticket,
        fp.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(fp.COR_PRODUTO, '') AS cor,
        ISNULL(c.DESC_COR, '') AS corDescricao,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        CAST(fp.QTDE AS FLOAT) AS quantidade,
        f.FILIAL AS filial,
        ISNULL(fp.VALOR_LIQUIDO, 0) AS valorLiquido
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = fp.COR_PRODUTO
        WHERE f.EMISSAO >= @periodoStart
          AND f.EMISSAO < @periodoEnd
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        ${ecommerceFilialFilter}
        ${categoriaFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      ` : ''}
      
      ORDER BY data DESC, ticket, produto, cor
    `;

    const result = await request.query<{
      data: Date;
      ticket: string;
      produto: string;
      descricao: string;
      cor: string;
      corDescricao: string;
      linha: string | null;
      subgrupo: string | null;
      grade: string | null;
      colecao: string | null;
      quantidade: number | null;
      filial: string;
      valorLiquido: number | null;
    }>(query);

    // Montar resultado final
    return result.recordset.map(row => ({
      data: row.data,
      ticket: row.ticket || '',
      produto: row.produto || '',
      descricao: row.descricao || '',
      cor: row.cor || '',
      corDescricao: row.corDescricao || '',
      linha: row.linha || undefined,
      subgrupo: row.subgrupo || undefined,
      grade: row.grade || undefined,
      colecao: row.colecao || undefined,
      quantidade: Number(row.quantidade ?? 0),
      filial: row.filial || '',
      valorLiquido: Number(row.valorLiquido ?? 0),
    }));
  });
}

/**
 * Busca detalhes das vendas de e-commerce da semana para uma categoria específica
 */
export async function fetchDetalhesEcommerceSemana({
  company,
  filial,
  categoria,
  linha,
  subgrupo,
  grade,
  colecao,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
  range,
}: {
  company?: string;
  filial?: string | null;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  range?: { start?: Date | string; end?: Date | string };
}): Promise<DetalheEcommerceSemana[]> {
  return withRequest(async (request) => {
    // E-commerce só existe para ScarfMe
    if (company !== 'scarfme') {
      return [];
    }

    // Calcular período baseado no range selecionado
    // Usar normalizeRangeForQuery para garantir tratamento correto de timezone e inclusão do último dia
    const normalizedRange = normalizeRangeForQuery(range);
    const periodoStart = normalizedRange.start;
    const periodoEnd = normalizedRange.end;
    
    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    // Criar filtros de categoria
    const categoriaField = 'ISNULL(p.LINHA, \'SEM LINHA\')';
    
    let categoriaFilter = '';
    request.input('categoria', sql.VarChar, categoria.trim());
    categoriaFilter = `AND ISNULL(p.LINHA, 'SEM LINHA') = @categoria`;

    // Filtros adicionais
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas || (linha ? [linha] : []), 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes || (colecao ? [colecao] : []), 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos || (subgrupo ? [subgrupo] : []), 'p');
    const gradeFilter = buildGradeFilter(request, company, grades || (grade ? [grade] : []), 'p');

    // Filtro de filial para e-commerce
    let ecommerceFilialFilter = '';
    const companyConfig = resolveCompany(company);
    if (companyConfig) {
      const filiais = companyConfig.filialFilters['inventory'] ?? [];
      const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

      if (filial && filial !== VAREJO_VALUE) {
        request.input('ecommerceDetalheFilial', sql.VarChar, filial);
        ecommerceFilialFilter = `AND f.FILIAL = @ecommerceDetalheFilial`;
      } else if (filial === null) {
        // Todas as filiais (incluindo e-commerce)
        if (filiais.length > 0) {
          filiais.forEach((f, index) => {
            request.input(`ecommerceDetalheFilial${index}`, sql.VarChar, f);
          });
          const placeholders = filiais.map((_, i) => `@ecommerceDetalheFilial${i}`).join(', ');
          ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
        }
      } else {
        // Apenas e-commerce quando filial é VAREJO ou undefined
        if (ecommerceFilials.length > 0) {
          ecommerceFilials.forEach((f, index) => {
            request.input(`ecommerceDetalheFilial${index}`, sql.VarChar, f);
          });
          const placeholders = ecommerceFilials.map((_, i) => `@ecommerceDetalheFilial${i}`).join(', ');
          ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
        }
      }
    }

    // Buscar e-commerce detalhado
    const query = `
      SELECT 
        f.EMISSAO AS data,
        f.NF_SAIDA AS nf,
        f.SERIE_NF AS serie,
        fp.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(fp.COR_PRODUTO, '') AS cor,
        ISNULL(c.DESC_COR, '') AS corDescricao,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        CAST(fp.QTDE AS FLOAT) AS quantidade,
        f.FILIAL AS filial,
        ISNULL(fp.VALOR_LIQUIDO, 0) AS valorLiquido
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = fp.COR_PRODUTO
        WHERE f.EMISSAO >= @periodoStart
          AND f.EMISSAO < @periodoEnd
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        ${ecommerceFilialFilter}
        ${categoriaFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      ORDER BY f.EMISSAO DESC, f.NF_SAIDA, fp.PRODUTO, fp.COR_PRODUTO
    `;

    const result = await request.query<{
      data: Date;
      nf: string;
      serie: string;
      produto: string;
      descricao: string;
      cor: string;
      corDescricao: string;
      linha: string | null;
      subgrupo: string | null;
      grade: string | null;
      colecao: string | null;
      quantidade: number | null;
      filial: string;
      valorLiquido: number | null;
    }>(query);

    // Montar resultado final
    return result.recordset.map(row => ({
      data: row.data,
      nf: row.nf || '',
      serie: row.serie || '',
      produto: row.produto || '',
      descricao: row.descricao || '',
      cor: row.cor || '',
      corDescricao: row.corDescricao || '',
      linha: row.linha || undefined,
      subgrupo: row.subgrupo || undefined,
      grade: row.grade || undefined,
      colecao: row.colecao || undefined,
      quantidade: Number(row.quantidade ?? 0),
      filial: row.filial || '',
      valorLiquido: Number(row.valorLiquido ?? 0),
    }));
  });
}

/**
 * Busca dados de vendas por categoria
 */
export async function fetchVendasPorCategoria({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<VendasCategoriaData[]> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    request.input('currentStart', sql.DateTime, currentMonth.start);
    request.input('currentEnd', sql.DateTime, currentMonth.end);

    const query = `
      SELECT 
        ${categoriaField} AS categoria,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @currentStart
        AND vp.DATA_VENDA < @currentEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) > 0
      ORDER BY vendas DESC
    `;

    const result = await request.query<{
      categoria: string;
      vendas: number | null;
    }>(query);

    return result.recordset.map(row => ({
      categoria: row.categoria?.trim() || '',
      vendas: Math.round(Number(row.vendas ?? 0)),
    }));
  });
}

/**
 * Busca previsões de vendas e estoque
 */
export async function fetchPrevisoesEstoque({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<PrevisaoEstoque[]> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1; // 1-12
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };
    
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // Determinar se devemos mostrar detalhes (quando há filtros selecionados)
    const mostrarDetalhes = company === 'scarfme' && (
      (linhas && linhas.length > 0) || 
      (colecoes && colecoes.length > 0) || 
      (subgrupos && subgrupos.length > 0) || 
      (grades && grades.length > 0)
    );

    // Se mostrar detalhes, incluir campos adicionais e agrupar por eles
    const camposAdicionais = mostrarDetalhes
      ? `, ISNULL(p.LINHA, '') AS linha, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`
      : '';
    
    const groupByAdicional = mostrarDetalhes
      ? `, ISNULL(p.LINHA, ''), ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`
      : '';

    // Campos adicionais para queries de vendas (mesmo que camposAdicionais, mas para queries de vendas)
    const camposVendasAdicionais = camposAdicionais;
    const groupByVendasAdicional = groupByAdicional;

    // Estoque por categoria (com detalhes se necessário)
    const estoqueQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposAdicionais},
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueAtual
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByAdicional}
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    `;

    const estoqueResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      estoqueAtual: number | null;
    }>(estoqueQuery);

    // Buscar vendas do mês atual até hoje para calcular projeção
    // Projeção = (vendas até hoje / dias corridos) × total de dias do mês
    const hoje = new Date(now.getTime());
    hoje.setHours(23, 59, 59, 999); // Fim do dia de hoje

    // Buscar vendas do mês atual até hoje
    const vendasMensaisQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposVendasAdicionais},
        YEAR(vp.DATA_VENDA) AS ano,
        MONTH(vp.DATA_VENDA) AS mes,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @currentMonthStart
        AND vp.DATA_VENDA <= @hoje
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY ${categoriaField}${groupByVendasAdicional}, YEAR(vp.DATA_VENDA), MONTH(vp.DATA_VENDA)
    `;

    request.input('currentMonthStart', sql.DateTime, currentMonth.start);
    request.input('hoje', sql.DateTime, hoje);

    const vendasMensaisResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      ano: number;
      mes: number;
      vendas: number | null;
    }>(vendasMensaisQuery);

    // Agrupar vendas por categoria e mês (usar chave composta quando mostrarDetalhes)
    // Usar chave ano-mês para garantir que pegamos os últimos 3 meses completos
    const vendasPorCategoriaMes = new Map<string, Map<string, number>>();
    vendasMensaisResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // Se mostrarDetalhes, criar chave composta incluindo os campos adicionais
      // SEMPRE usar chave detalhada
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      const chaveAnoMes = `${row.ano}-${row.mes}`;
      const vendas = Number(row.vendas ?? 0);
      
      if (!vendasPorCategoriaMes.has(chaveCategoria)) {
        vendasPorCategoriaMes.set(chaveCategoria, new Map());
      }
      vendasPorCategoriaMes.get(chaveCategoria)!.set(chaveAnoMes, vendas);
    });

    // Processar resultados conforme lógica do Python
    const previsoes: PrevisaoEstoque[] = estoqueResult.recordset.map(row => {
      const categoria = row.categoria?.trim() || '';
      const estoqueAtual = Number(row.estoqueAtual ?? 0);
      
      // Campos detalhados (quando mostrarDetalhes é true)
      const linha = mostrarDetalhes ? (row.linha?.trim() || '') : undefined;
      const subgrupo = mostrarDetalhes ? (row.subgrupo?.trim() || '') : undefined;
      const grade = mostrarDetalhes ? (row.grade?.trim() || '') : undefined;
      const colecao = mostrarDetalhes ? (row.colecao?.trim() || '') : undefined;

      // Criar chave para buscar vendas (usar chave composta quando mostrarDetalhes)
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${linha || ''}|${subgrupo || ''}|${grade || ''}|${colecao || ''}`
        : categoria;
      
      // Buscar vendas do mês atual até hoje para calcular projeção
      // Projeção = (vendas até hoje / dias corridos) × total de dias do mês
      const chaveMesAtual = `${currentYear}-${currentMonthNum}`;
      const vendasMeses = vendasPorCategoriaMes.get(chaveCategoria);
      const vendasAteHoje = vendasMeses?.get(chaveMesAtual) || 0;
      
      // Calcular dias corridos do mês até hoje
      const diasCorridos = now.getDate(); // Dia do mês (1-31)
      
      // Calcular total de dias do mês
      const totalDiasMes = new Date(currentYear, currentMonthNum, 0).getDate(); // Último dia do mês
      
      // Calcular Projeção Mensal = (vendas até hoje / dias corridos) × total de dias do mês
      const projecaoMensal = diasCorridos > 0
        ? Math.round((vendasAteHoje / diasCorridos) * totalDiasMes)
        : 0;

      // Calcular Projeção Ano = Projeção Mensal × meses restantes
      const mesesRestantes = Math.max(0, 12 - currentMonthNum + 1);
      const projecaoAnual = Math.round(projecaoMensal * mesesRestantes);

      // Calcular Estoque Final Mês = Estoque - Projeção Mensal
      const prevFimMes = Math.round(estoqueAtual - projecaoMensal);

      // Calcular Estoque Final Ano = Estoque - Projeção Ano
      const prevFimAno = Math.round(estoqueAtual - projecaoAnual);

      // Calcular Dias de Estoque = (Estoque / Projeção Mensal) × total de dias do mês
      // Isso calcula quantos dias o estoque atual durará baseado na projeção de vendas mensal
      // Exemplo: Se temos 100 unidades e a projeção mensal é 50 unidades (em 31 dias),
      // então temos 2 meses de estoque = 2 × 31 = 62 dias
      const diasEstoque = projecaoMensal > 0
        ? Math.round((estoqueAtual / projecaoMensal) * totalDiasMes)
        : 999;

      // Média diária = Projeção Mensal / total de dias do mês
      const mediaDia = projecaoMensal > 0 ? projecaoMensal / totalDiasMes : 0;

      // Determinar status baseado em dias de estoque (conforme script Python: <=90 verde, 90-180 amarelo, >180 vermelho)
      let status: 'OK' | 'ALERTA' | 'CRITICO' = 'OK';
      if (diasEstoque <= 90) {
        status = 'OK';
      } else if (diasEstoque <= 180) {
        status = 'ALERTA';
      } else {
        status = 'CRITICO';
      }

      return {
        categoria,
        estoqueAtual: Math.round(estoqueAtual),
        mediaDia: Number(mediaDia.toFixed(1)),
        duracao: diasEstoque,
        prevFimMes,
        prevFimAno,
        status,
      };
    });

    return previsoes.sort((a, b) => b.estoqueAtual - a.estoqueAtual);
  });
}

/**
 * Interface para detalhes de variação de produto
 */
export interface ProdutoVariacaoDetalhes {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  estoque: number;
  custoUnitario: number;
  custoTotal: number;
  vendasTotais: number;
}

/**
 * Interface para resumo de detalhes do produto
 */
export interface ProdutoDetalhesResumo {
  totalItens: number;
  estoqueTotal: number;
  custoTotal: number;
  vendasTotais: number;
}

/**
 * Interface para resposta completa de detalhes do produto
 */
export interface ProdutoDetalhesCompleto {
  nomeProduto: string;
  resumo: ProdutoDetalhesResumo;
  variacoes: ProdutoVariacaoDetalhes[];
}

/**
 * Parâmetros para buscar detalhes de um produto
 */
export interface ProdutoDetalhesParams {
  company?: string;
  filial?: string | null;
  produtoNome?: string; // Nome do produto/linha (ex: "PASHMINA")
  linha?: string; // Linha específica (SCARFME)
  grupo?: string; // Grupo específico (NERD)
  subgrupo?: string; // Subgrupo específico
  grade?: string; // Grade específica
  colecao?: string; // Coleção específica
  cor?: string; // Cor específica
}

/**
 * Busca detalhes de um produto específico com todas as suas variações
 */
export async function fetchProdutoDetalhes({
  company,
  filial,
  produtoNome,
  linha,
  grupo,
  subgrupo,
  grade,
  colecao,
}: ProdutoDetalhesParams): Promise<ProdutoDetalhesCompleto> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };

    request.input('startDate', sql.DateTime, currentMonth.start);
    request.input('endDate', sql.DateTime, currentMonth.end);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    
    // Construir filtros baseados nos parâmetros
    // Criar filtros separados para estoque (alias 'e') e vendas (alias 'vp')
    let produtoFilterEstoque = '';
    let produtoFilterVendas = '';
    
    // PRIORIDADE 1: Se produtoNome for fornecido, filtrar diretamente pelo código do produto
    if (produtoNome) {
      const produtoNormalizado = produtoNome.trim().replace(/\s+/g, '');
      request.input('produtoCodigoEstoque', sql.VarChar, produtoNormalizado);
      request.input('produtoCodigoVendas', sql.VarChar, produtoNormalizado);
      produtoFilterEstoque = `AND LTRIM(RTRIM(e.PRODUTO)) = @produtoCodigoEstoque`;
      produtoFilterVendas = `AND LTRIM(RTRIM(vp.PRODUTO)) = @produtoCodigoVendas`;
    } else {
      // Se não houver produtoNome, usar filtros por categoria (grupo/linha)
      // Para NERD: usar grupo, para SCARFME: usar linha
      if (company === 'nerd' && grupo) {
        request.input('grupoFiltro', sql.VarChar, grupo.toUpperCase().trim());
        produtoFilterEstoque = `AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoFiltro`;
        produtoFilterVendas = `AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoFiltro`;
      } else if (linha) {
        // SCARFME: Se linha for fornecida, usar ela
        request.input('linhaFiltro', sql.VarChar, linha.toUpperCase().trim());
        produtoFilterEstoque = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaFiltro`;
        produtoFilterVendas = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaFiltro`;
      }
    }
    
    // Filtros adicionais (subgrupo, grade, colecao) - aplicar em ambos os filtros
    if (subgrupo) {
      request.input('subgrupo', sql.VarChar, subgrupo.toUpperCase().trim());
      produtoFilterEstoque += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
      produtoFilterVendas += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
    }
    
    if (grade) {
      request.input('grade', sql.VarChar, grade.toUpperCase().trim());
      produtoFilterEstoque += ` AND UPPER(LTRIM(RTRIM(CONVERT(VARCHAR, p.GRADE)))) = @grade`;
      produtoFilterVendas += ` AND UPPER(LTRIM(RTRIM(CONVERT(VARCHAR, p.GRADE)))) = @grade`;
    }
    
    if (colecao) {
      request.input('colecao', sql.VarChar, colecao.toUpperCase().trim());
      produtoFilterEstoque += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao`;
      produtoFilterVendas += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao`;
    }
    
    // Para NERD, também aplicar filtro de grupo se fornecido (para garantir que está no grupo correto)
    if (produtoNome && company === 'nerd' && grupo) {
      request.input('grupoFiltro', sql.VarChar, grupo.toUpperCase().trim());
      produtoFilterEstoque += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoFiltro`;
      produtoFilterVendas += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoFiltro`;
    }

    // Buscar todas as variações do produto com estoque
    const variacoesQuery = `
      SELECT 
        e.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ${company === 'nerd' ? 'ISNULL(p.GRUPO_PRODUTO, \'\') AS linha,' : 'ISNULL(p.LINHA, \'\') AS linha,'}
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(COALESCE(c.DESC_COR, e.COR_PRODUTO), '') AS cor,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque,
        ISNULL(p.CUSTO_REPOSICAO1, 0) AS custoUnitario,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
        ${produtoFilterEstoque}
        AND e.ESTOQUE > 0
        ${company === 'nerd' ? `AND ISNULL(p.GRUPO_PRODUTO, '') <> ''` : `AND ISNULL(p.LINHA, '') <> ''`}
      GROUP BY 
        e.PRODUTO,
        p.DESC_PRODUTO,
        ${company === 'nerd' ? 'p.GRUPO_PRODUTO,' : 'p.LINHA,'}
        p.SUBGRUPO_PRODUTO,
        p.GRADE,
        p.COLECAO,
        COALESCE(c.DESC_COR, e.COR_PRODUTO),
        p.CUSTO_REPOSICAO1
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
      ORDER BY SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) DESC, e.PRODUTO, COALESCE(c.DESC_COR, e.COR_PRODUTO)
    `;

    const variacoesResult = await request.query<{
      produto: string;
      descricao: string;
      linha: string;
      subgrupo: string;
      grade: string;
      colecao: string;
      cor: string;
      estoque: number | null;
      custoUnitario: number | null;
      custoTotal: number | null;
    }>(variacoesQuery);

    // Buscar vendas acumuladas por produto e cor
    const vendasQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS cor,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendasTotais
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${produtoFilterVendas}
        ${company === 'nerd' ? `AND ISNULL(p.GRUPO_PRODUTO, '') <> ''` : `AND ISNULL(p.LINHA, '') <> ''`}
      GROUP BY 
        vp.PRODUTO,
        COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO)
    `;

    const vendasResult = await request.query<{
      produto: string;
      cor: string;
      vendasTotais: number | null;
    }>(vendasQuery);

    // Criar mapa de vendas: chave = produto|cor
    const vendasMap = new Map<string, number>();
    vendasResult.recordset.forEach((row) => {
      const key = `${row.produto?.trim() || ''}|${row.cor?.trim() || ''}`;
      vendasMap.set(key, Math.round(Number(row.vendasTotais ?? 0)));
    });

    const variacoes: ProdutoVariacaoDetalhes[] = variacoesResult.recordset.map((row) => {
      const key = `${row.produto?.trim() || ''}|${row.cor?.trim() || ''}`;
      const vendas = vendasMap.get(key) || 0;

      return {
        produto: row.produto?.trim() || '',
        descricao: row.descricao?.trim() || '',
        linha: row.linha?.trim() || '',
        subgrupo: row.subgrupo?.trim() || '',
        grade: row.grade?.trim() || '',
        colecao: row.colecao?.trim() || '',
        cor: row.cor?.trim() || '',
        estoque: Math.round(Number(row.estoque ?? 0)),
        custoUnitario: Number(row.custoUnitario ?? 0),
        custoTotal: Number(row.custoTotal ?? 0),
        vendasTotais: vendas,
      };
    });

    // Calcular resumo
    const totalItens = variacoes.length;
    const estoqueTotal = variacoes.reduce((sum, v) => sum + v.estoque, 0);
    const custoTotal = variacoes.reduce((sum, v) => sum + v.custoTotal, 0);
    const vendasTotais = variacoes.reduce((sum, v) => sum + v.vendasTotais, 0);

    // Determinar nome do produto (usar linha/grupo se disponível, senão usar produtoNome ou linha/grupo do parâmetro)
    const nomeProduto = variacoes.length > 0 
      ? variacoes[0].linha || (company === 'nerd' ? grupo : linha) || produtoNome || 'Produto'
      : (company === 'nerd' ? grupo : linha) || produtoNome || 'Produto';

    return {
      nomeProduto,
      resumo: {
        totalItens,
        estoqueTotal,
        custoTotal,
        vendasTotais,
      },
      variacoes,
    };
  });
}

/**
 * Interface para detalhes de variação de produto por filial
 */
export interface ProdutoVariacaoDetalhesPorFilial {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  filial: string;
  estoque: number;
  custoUnitario: number;
  custoTotal: number;
  vendasTotais: number;
}

/**
 * Interface para resumo de detalhes do produto por filial
 */
export interface ProdutoDetalhesResumoPorFilial {
  totalFiliais: number;
  estoqueTotal: number;
  custoTotal: number;
  vendasTotais: number;
}

/**
 * Interface para resposta completa de detalhes do produto por filial
 */
export interface ProdutoDetalhesCompletoPorFilial {
  nomeProduto: string;
  resumo: ProdutoDetalhesResumoPorFilial;
  variacoes: ProdutoVariacaoDetalhesPorFilial[];
}

/**
 * Busca detalhes de um produto específico com todas as suas variações por filial
 */
export async function fetchProdutoDetalhesPorFilial({
  company,
  filial,
  produtoNome,
  linha,
  grupo,
  subgrupo,
  grade,
  colecao,
  cor,
}: ProdutoDetalhesParams): Promise<ProdutoDetalhesCompletoPorFilial> {
  return withRequest(async (request) => {
    const now = new Date();
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };

    request.input('startDate', sql.DateTime, currentMonth.start);
    request.input('endDate', sql.DateTime, currentMonth.end);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    
    // Construir filtros baseados nos parâmetros - IGUAL AO DETALHADO 01
    let produtoFilter = '';
    
    // Se produtoNome (código do produto) for fornecido, filtrar pelo código do produto diretamente
    if (produtoNome) {
      // Normalizar o código do produto (remover todos os espaços e converter para maiúsculo)
      const produtoCodigoNormalizado = produtoNome.toUpperCase().trim().replace(/\s+/g, '');
      request.input('produtoCodigoEstoque', sql.VarChar, produtoCodigoNormalizado);
      produtoFilter = `AND UPPER(REPLACE(LTRIM(RTRIM(e.PRODUTO)), ' ', '')) = @produtoCodigoEstoque`;
    } else {
      // Para NERD: usar grupo, para SCARFME: usar linha
      if (company === 'nerd' && grupo) {
        request.input('grupoFiltro', sql.VarChar, grupo.toUpperCase().trim());
        produtoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoFiltro`;
      } else if (linha) {
        // SCARFME: Se não tiver produtoNome mas tiver linha, usar linha
        request.input('linhaFiltro', sql.VarChar, linha.toUpperCase().trim());
        produtoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaFiltro`;
      }
    }
    
    if (subgrupo) {
      request.input('subgrupo', sql.VarChar, subgrupo.toUpperCase().trim());
      produtoFilter += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo`;
    }
    
    if (grade) {
      request.input('grade', sql.VarChar, grade.toUpperCase().trim());
      produtoFilter += ` AND UPPER(LTRIM(RTRIM(CONVERT(VARCHAR, p.GRADE)))) = @grade`;
    }
    
    if (colecao) {
      request.input('colecao', sql.VarChar, colecao.toUpperCase().trim());
      produtoFilter += ` AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao`;
    }

    // Filtro de cor (se fornecido)
    let corFilter = '';
    if (cor) {
      // Normalizar cor (remover espaços extras e converter para maiúsculo)
      const corNormalizada = cor.trim().replace(/\s+/g, ' ').toUpperCase();
      request.input('corFiltro', sql.VarChar, corNormalizada);
      corFilter = `AND UPPER(LTRIM(RTRIM(REPLACE(ISNULL(COALESCE(c.DESC_COR, e.COR_PRODUTO), ''), ' ', '')))) = UPPER(REPLACE(LTRIM(RTRIM(@corFiltro)), ' ', ''))`;
    }

    // Buscar todas as variações do produto com estoque por filial
    const variacoesQuery = `
      SELECT 
        e.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ${company === 'nerd' ? 'ISNULL(p.GRUPO_PRODUTO, \'\') AS linha,' : 'ISNULL(p.LINHA, \'\') AS linha,'}
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(COALESCE(c.DESC_COR, e.COR_PRODUTO), '') AS cor,
        e.FILIAL AS filial,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque,
        ISNULL(p.CUSTO_REPOSICAO1, 0) AS custoUnitario,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
        ${produtoFilter}
        ${corFilter}
        AND e.ESTOQUE > 0
        ${company === 'nerd' ? `AND ISNULL(p.GRUPO_PRODUTO, '') <> ''` : `AND ISNULL(p.LINHA, '') <> ''`}
      GROUP BY 
        e.PRODUTO,
        p.DESC_PRODUTO,
        ${company === 'nerd' ? 'p.GRUPO_PRODUTO,' : 'p.LINHA,'}
        p.SUBGRUPO_PRODUTO,
        p.GRADE,
        p.COLECAO,
        COALESCE(c.DESC_COR, e.COR_PRODUTO),
        p.CUSTO_REPOSICAO1,
        e.FILIAL
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
      ORDER BY SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) DESC, e.PRODUTO, COALESCE(c.DESC_COR, e.COR_PRODUTO), e.FILIAL
    `;

    const variacoesResult = await request.query<{
      produto: string;
      descricao: string;
      linha: string;
      subgrupo: string;
      grade: string;
      colecao: string;
      cor: string;
      filial: string;
      estoque: number | null;
      custoUnitario: number | null;
      custoTotal: number | null;
    }>(variacoesQuery);

    // Buscar vendas SIMPLES: apenas do produto específico, agrupado por cor e filial
    // Se temos produtoNome (código do produto), filtrar APENAS por ele (SEM filtro de filial)
    let vendasFilter = '';
    let usarFiltroFilialVendas = true;
    let vendasCorFilter = '';
    
    if (produtoNome) {
      // Quando temos código do produto específico, buscar vendas em TODAS as filiais
      // Normalizar o código do produto (remover espaços e converter para maiúsculo)
      const produtoCodigoNormalizado = produtoNome.toUpperCase().trim().replace(/\s+/g, '');
      request.input('produtoCodigo', sql.VarChar, produtoCodigoNormalizado);
      vendasFilter = `AND UPPER(REPLACE(LTRIM(RTRIM(vp.PRODUTO)), ' ', '')) = @produtoCodigo`;
      usarFiltroFilialVendas = false; // Não filtrar por filial quando temos produto específico
    } else {
      // Senão, usar os filtros normais (linha, subgrupo, etc) E filtro de filial
      vendasFilter = produtoFilter;
    }
    
    // Filtro de cor para vendas (se fornecido)
    if (cor) {
      // Normalizar cor (remover espaços extras e converter para maiúsculo)
      const corNormalizadaVendas = cor.trim().replace(/\s+/g, ' ').toUpperCase();
      request.input('corFiltroVendas', sql.VarChar, corNormalizadaVendas);
      vendasCorFilter = `AND UPPER(REPLACE(LTRIM(RTRIM(ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), ''))), ' ', '')) = UPPER(REPLACE(LTRIM(RTRIM(@corFiltroVendas)), ' ', ''))`;
    }
    
    const vendasQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS cor,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendasTotais
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${usarFiltroFilialVendas ? vendasFilialFilter : ''}
        ${vendasFilter}
        ${vendasCorFilter}
      GROUP BY 
        vp.PRODUTO,
        COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO),
        vp.FILIAL
    `;

    const vendasResult = await request.query<{
      produto: string;
      cor: string;
      filial: string;
      vendasTotais: number | null;
    }>(vendasQuery);

    // Função para normalizar strings (remover espaços extras e trim)
    const normalizeString = (str: string | null | undefined): string => {
      if (!str) return '';
      return str.trim().replace(/\s+/g, ' ');
    };

    // Criar mapa de vendas: chave = produto|cor|filial (para distribuir as vendas por filial)
    const vendasMap = new Map<string, number>();
    vendasResult.recordset.forEach((row) => {
      const produtoNorm = normalizeString(row.produto);
      const corNorm = normalizeString(row.cor);
      const filialNorm = normalizeString(row.filial);
      const key = `${produtoNorm}|${corNorm}|${filialNorm}`;
      vendasMap.set(key, Math.round(Number(row.vendasTotais ?? 0)));
    });

    // Criar mapa de variações existentes (do estoque): chave = produto|cor|filial
    const variacoesMap = new Map<string, typeof variacoesResult.recordset[0]>();
    variacoesResult.recordset.forEach((row) => {
      const produtoNorm = normalizeString(row.produto);
      const corNorm = normalizeString(row.cor);
      const filialNorm = normalizeString(row.filial);
      const key = `${produtoNorm}|${corNorm}|${filialNorm}`;
      variacoesMap.set(key, row);
    });

    // Criar lista de variações: incluir todas do estoque + filiais com vendas mas sem estoque
    const variacoes: ProdutoVariacaoDetalhesPorFilial[] = [];
    
    // Primeiro, adicionar todas as variações do estoque com suas vendas
    variacoesResult.recordset.forEach((row) => {
      const produtoNorm = normalizeString(row.produto);
      const corNorm = normalizeString(row.cor);
      const filialNorm = normalizeString(row.filial);
      const key = `${produtoNorm}|${corNorm}|${filialNorm}`;
      const vendas = vendasMap.get(key) || 0;

      variacoes.push({
        produto: row.produto?.trim() || '',
        descricao: row.descricao?.trim() || '',
        linha: row.linha?.trim() || '',
        subgrupo: row.subgrupo?.trim() || '',
        grade: row.grade?.trim() || '',
        colecao: row.colecao?.trim() || '',
        cor: row.cor?.trim() || '',
        filial: row.filial?.trim() || '',
        estoque: Math.round(Number(row.estoque ?? 0)),
        custoUnitario: Number(row.custoUnitario ?? 0),
        custoTotal: Number(row.custoTotal ?? 0),
        vendasTotais: vendas,
      });
    });

    // Depois, adicionar filiais que têm vendas mas não têm estoque
    vendasResult.recordset.forEach((row) => {
      const produtoNorm = normalizeString(row.produto);
      const corNorm = normalizeString(row.cor);
      const filialNorm = normalizeString(row.filial);
      const key = `${produtoNorm}|${corNorm}|${filialNorm}`;
      
      // Se não existe no estoque, adicionar com estoque 0
      if (!variacoesMap.has(key)) {
        // Buscar dados do produto de uma variação existente para pegar descrição, linha, etc
        const primeiraVariacao = variacoesResult.recordset[0];
        variacoes.push({
          produto: row.produto?.trim() || '',
          descricao: primeiraVariacao?.descricao?.trim() || '',
          linha: primeiraVariacao?.linha?.trim() || '',
          subgrupo: primeiraVariacao?.subgrupo?.trim() || '',
          grade: primeiraVariacao?.grade?.trim() || '',
          colecao: primeiraVariacao?.colecao?.trim() || '',
          cor: row.cor?.trim() || '',
          filial: row.filial?.trim() || '',
          estoque: 0,
          custoUnitario: primeiraVariacao ? Number(primeiraVariacao.custoUnitario ?? 0) : 0,
          custoTotal: 0,
          vendasTotais: Math.round(Number(row.vendasTotais ?? 0)),
        });
      }
    });

    // Calcular resumo
    const filiaisUnicas = new Set(variacoes.map(v => v.filial));
    const totalFiliais = filiaisUnicas.size;
    const estoqueTotal = variacoes.reduce((sum, v) => sum + v.estoque, 0);
    const custoTotal = variacoes.reduce((sum, v) => sum + v.custoTotal, 0);
    const vendasTotais = variacoes.reduce((sum, v) => sum + v.vendasTotais, 0);

    // Determinar nome do produto (usar linha se disponível, senão usar produtoNome ou linha do parâmetro)
    const nomeProduto = variacoes.length > 0 
      ? variacoes[0].linha || linha || produtoNome || 'Produto'
      : linha || produtoNome || 'Produto';

    return {
      nomeProduto,
      resumo: {
        totalFiliais,
        estoqueTotal,
        custoTotal,
        vendasTotais,
      },
      variacoes,
    };
  });
}
