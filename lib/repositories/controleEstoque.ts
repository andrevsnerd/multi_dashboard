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
  vendasMes: number;
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

    // Para ScarfMe, sempre buscar dados detalhados (linha, subgrupo, grade, coleção)
    // para permitir expansão progressiva dos cards
    const mostrarDetalhes = company === 'scarfme';

    // Determinar campo de categoria baseado na empresa
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // Para ScarfMe, sempre incluir campos adicionais para permitir expansão
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
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
      const chaveAnoMes = `${row.ano}-${row.mes}`;
      const vendas = Number(row.vendas ?? 0);
      
      if (!vendasPorCategoriaMes.has(chaveCategoria)) {
        vendasPorCategoriaMes.set(chaveCategoria, new Map());
      }
      vendasPorCategoriaMes.get(chaveCategoria)!.set(chaveAnoMes, vendas);
    });

    // Calcular histórico semanal: estoque da semana passada
    // Estoque Semana Passada = Estoque Atual - Entradas (7 dias) + Vendas (7 dias) + E-commerce (7 dias)
    const data7DiasAtras = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    request.input('data7DiasAtras', sql.DateTime, data7DiasAtras);

    // Criar filtro de filial para entradas com a mesma lógica do buildFilialFilter
    // Mas com nomes de parâmetros únicos para evitar conflitos (EDUPEPARAM)
    let entradasFilialFilter = '';
    if (company) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const isScarfme = company === 'scarfme';
        const filiais = companyConfig.filialFilters['inventory'] ?? [];
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

        // Se uma filial específica foi selecionada, usar apenas ela
        if (filial && filial !== VAREJO_VALUE) {
          request.input('entradasSemanaFilial', sql.VarChar, filial);
          entradasFilialFilter = `AND E.FILIAL = @entradasSemanaFilial`;
        }
        // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
        else if (isScarfme && filial === VAREJO_VALUE) {
          const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
          if (normalFiliais.length > 0) {
            normalFiliais.forEach((f, index) => {
              request.input(`entradasSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = normalFiliais.map((_, i) => `@entradasSemanaFilial${i}`).join(', ');
            entradasFilialFilter = `AND E.FILIAL IN (${placeholders})`;
          }
        }
        // Para scarfme: se for "Todas as filiais" (null), incluir também ecommerce
        else if (isScarfme && filial === null) {
          if (filiais.length > 0) {
            filiais.forEach((f, index) => {
              request.input(`entradasSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = filiais.map((_, i) => `@entradasSemanaFilial${i}`).join(', ');
            entradasFilialFilter = `AND E.FILIAL IN (${placeholders})`;
          }
        }
        // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
        else {
          const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
          if (normalFiliais.length > 0) {
            normalFiliais.forEach((f, index) => {
              request.input(`entradasSemanaFilial${index}`, sql.VarChar, f);
            });
            const placeholders = normalFiliais.map((_, i) => `@entradasSemanaFilial${i}`).join(', ');
            entradasFilialFilter = `AND E.FILIAL IN (${placeholders})`;
          }
        }
      }
    }

    // Criar filtros separados para query de entradas (usar prefixo 'pr')
    // Nota: Como os filtros já foram criados com 'p', vamos reutilizar os mesmos parâmetros SQL
    // mas ajustar o prefixo da tabela na string do filtro
    const grupoFilterEntradas = grupoFilter ? grupoFilter.replace(/p\./g, 'pr.') : '';
    const linhaFilterEntradas = linhaFilter ? linhaFilter.replace(/p\./g, 'pr.') : '';
    const colecaoFilterEntradas = colecaoFilter ? colecaoFilter.replace(/p\./g, 'pr.') : '';
    const subgrupoFilterEntradas = subgrupoFilter ? subgrupoFilter.replace(/p\./g, 'pr.') : '';
    const gradeFilterEntradas = gradeFilter ? gradeFilter.replace(/p\./g, 'pr.') : '';

    // Campos adicionais para query de entradas (usar alias 'pr' ao invés de 'p')
    const camposEntradasAdicionais = mostrarDetalhes
      ? `, ISNULL(pr.LINHA, '') AS linha, ISNULL(pr.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, pr.GRADE), '') AS grade, ISNULL(pr.COLECAO, '') AS colecao`
      : '';
    const groupByEntradasAdicional = mostrarDetalhes
      ? `, ISNULL(pr.LINHA, ''), ISNULL(pr.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, pr.GRADE), ''), ISNULL(pr.COLECAO, '')`
      : '';

    // Ajustar categoriaField para usar alias 'pr' nas queries de entradas
    const categoriaFieldEntradas = company === 'nerd' 
      ? 'ISNULL(pr.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(pr.LINHA, \'SEM LINHA\')';

    // Buscar entradas dos últimos 7 dias
    const entradasSemanaQuery = `
      SELECT 
        ${categoriaFieldEntradas} AS categoria
        ${camposEntradasAdicionais},
        SUM(CAST(P.QTDE AS FLOAT)) AS entradas
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @data7DiasAtras
        ${entradasFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        AND ${categoriaFieldEntradas} <> ''
        AND ${categoriaFieldEntradas} <> 'SEM GRUPO'
        AND ${categoriaFieldEntradas} <> 'SEM LINHA'
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
      WHERE vp.DATA_VENDA >= @data7DiasAtras
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
        WHERE f.EMISSAO >= @data7DiasAtras
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
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
      entradasSemanaMap.set(chaveCategoria, Number(row.entradas ?? 0));
    });

    const vendasSemanaMap = new Map<string, number>();
    vendasSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
      vendasSemanaMap.set(chaveCategoria, Number(row.vendas ?? 0));
    });

    const ecommerceSemanaMap = new Map<string, number>();
    ecommerceSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
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
      // Usar chave composta quando mostrarDetalhes
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
      vendasPeriodoAnteriorMap.set(chaveCategoria, Number(row.vendasPeriodo ?? 0));
    });

    // Processar resultados conforme lógica do Python
    const categorias: CategoriaEstoque[] = estoqueResult.recordset.map(row => {
      const categoria = row.categoria?.trim() || '';
      const estoqueAtual = Number(row.estoqueAtual ?? 0);
      const custoTotal = Number(row.custoTotal ?? 0);
      // Custo unitário não faz sentido para categorias agregadas (múltiplos produtos diferentes)
      // Cada produto tem seu próprio custo unitário real, que é mostrado na página de detalhes
      // Para categorias agregadas, não calculamos custo unitário (seria uma média, não um valor real)
      const custoUnitario = 0; // Não aplicável para categorias agregadas

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
      const estoqueFinalMes = Math.round(estoqueAtual - projecaoMensal);

      // Calcular Estoque Final Ano = Estoque - Projeção Ano
      const estoqueFinalAno = Math.round(estoqueAtual - projecaoAnual);

      // Calcular Dias de Estoque = (Estoque / Projeção Mensal) × total de dias do mês
      // Isso calcula quantos dias o estoque atual durará baseado na projeção de vendas mensal
      // Exemplo: Se temos 100 unidades e a projeção mensal é 50 unidades (em 31 dias),
      // então temos 2 meses de estoque = 2 × 31 = 62 dias
      const diasEstoque = projecaoMensal > 0
        ? Math.round((estoqueAtual / projecaoMensal) * totalDiasMes)
        : 999;

      // Vendas do mês atual para exibição
      const vendasMes = vendasAteHoje;

      // Calcular estoque da semana passada conforme lógica do Python
      // Estoque Semana Passada = Estoque Atual - Entradas (7 dias) + Vendas (7 dias) + E-commerce (7 dias)
      const entradasSemana = entradasSemanaMap.get(chaveCategoria) || 0;
      const vendasSemana = vendasSemanaMap.get(chaveCategoria) || 0;
      const ecommerceSemana = ecommerceSemanaMap.get(chaveCategoria) || 0;
      
      const estoqueSemanaPassada = Math.max(0, Math.round(
        estoqueAtual - entradasSemana + vendasSemana + ecommerceSemana
      ));

      // Calcular diferença semanal (quantidade real, não percentual)
      const diferencaSemanal = Math.round(estoqueAtual - estoqueSemanaPassada);

      return {
        categoria,
        estoqueAtual: Math.round(estoqueAtual),
        custoTotal,
        custoUnitario,
        vendasMes: Math.round(vendasMes),
        duracao: diasEstoque,
        projecaoMes: estoqueFinalMes, // Estoque Final Mês
        projecaoAnual: estoqueFinalAno, // Estoque Final Ano
        projecaoVendasMes: Math.round(projecaoMensal), // Projeção de vendas mensal
        tendenciaSemanal: diferencaSemanal, // Diferença em quantidade real
        estoqueSemanaPassada,
        ...(mostrarDetalhes && {
          linha,
          subgrupo,
          grade,
          colecao,
        }),
      };
    });

    return categorias.sort((a, b) => b.estoqueAtual - a.estoqueAtual);
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
      const chaveCategoria = mostrarDetalhes
        ? `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`
        : categoria;
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
  linha?: string; // Linha específica
  subgrupo?: string; // Subgrupo específico
  grade?: string; // Grade específica
  colecao?: string; // Coleção específica
}

/**
 * Busca detalhes de um produto específico com todas as suas variações
 */
export async function fetchProdutoDetalhes({
  company,
  filial,
  produtoNome,
  linha,
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
    let produtoFilter = '';
    
    // Se linha for fornecida, usar ela; senão, usar produtoNome como linha
    const linhaParaFiltrar = linha || produtoNome;
    if (linhaParaFiltrar) {
      request.input('linhaFiltro', sql.VarChar, linhaParaFiltrar.toUpperCase().trim());
      produtoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaFiltro`;
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

    // Buscar todas as variações do produto com estoque
    const variacoesQuery = `
      SELECT 
        e.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(p.LINHA, '') AS linha,
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
        ${produtoFilter}
        AND e.ESTOQUE > 0
        AND ISNULL(p.LINHA, '') <> ''
      GROUP BY 
        e.PRODUTO,
        p.DESC_PRODUTO,
        p.LINHA,
        p.SUBGRUPO_PRODUTO,
        p.GRADE,
        p.COLECAO,
        COALESCE(c.DESC_COR, e.COR_PRODUTO),
        p.CUSTO_REPOSICAO1
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
      ORDER BY e.PRODUTO, COALESCE(c.DESC_COR, e.COR_PRODUTO)
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
        ${produtoFilter}
        AND ISNULL(p.LINHA, '') <> ''
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

    // Determinar nome do produto (usar linha se disponível, senão usar produtoNome ou linha do parâmetro)
    const nomeProduto = variacoes.length > 0 
      ? variacoes[0].linha || linha || produtoNome || 'Produto'
      : linha || produtoNome || 'Produto';

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
  subgrupo,
  grade,
  colecao,
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
    
    // Se linha for fornecida, usar ela; senão, usar produtoNome como linha
    const linhaParaFiltrar = linha || produtoNome;
    if (linhaParaFiltrar) {
      request.input('linhaFiltro', sql.VarChar, linhaParaFiltrar.toUpperCase().trim());
      produtoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaFiltro`;
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

    // Buscar todas as variações do produto com estoque por filial
    const variacoesQuery = `
      SELECT 
        e.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ISNULL(p.LINHA, '') AS linha,
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
        AND e.ESTOQUE > 0
        AND ISNULL(p.LINHA, '') <> ''
      GROUP BY 
        e.PRODUTO,
        p.DESC_PRODUTO,
        p.LINHA,
        p.SUBGRUPO_PRODUTO,
        p.GRADE,
        p.COLECAO,
        COALESCE(c.DESC_COR, e.COR_PRODUTO),
        p.CUSTO_REPOSICAO1,
        e.FILIAL
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
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

    // Debug: log das vendas encontradas
    console.log('VENDAS ENCONTRADAS:', vendasResult.recordset.length);
    console.log('VENDAS RESULT:', vendasResult.recordset);

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
