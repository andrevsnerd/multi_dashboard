import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE, isEcommerceFilial, getFilialGroupMembers } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { getCurrentMonthRange, normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
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

  // Se uma filial específica foi selecionada, usar ela ou o grupo que ela representa
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    const members = getFilialGroupMembers(company, specificFilial);
    if (members.length > 1) {
      members.forEach((f, i) => request.input(`estoqueFilialGroup${i}`, sql.VarChar, f));
      const placeholders = members.map((_, i) => `@estoqueFilialGroup${i}`).join(', ');
      return `AND ${prefix}.FILIAL IN (${placeholders})`;
    }
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
    // Incluir todas as filiais (normais + e-commerce)
    // Combinar filiais normais com filiais de e-commerce para garantir que todas sejam incluídas
    const allFiliais = [...new Set([...filiais, ...ecommerceFilials])];
    
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
    const members = getFilialGroupMembers(company, specificFilial);
    if (members.length > 1) {
      members.forEach((f, i) => request.input(`vendasFilialGroup${i}`, sql.VarChar, f));
      const placeholders = members.map((_, i) => `@vendasFilialGroup${i}`).join(', ');
      return `AND ${prefix}.FILIAL IN (${placeholders})`;
    }
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
    // Quando "Todas as filiais" (null), excluir e-commerce da query de varejo
    // pois e-commerce tem query separada
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
  prefix: string = 'p',
  paramSuffix: string = ''
): string {
  if (company !== 'scarfme' || !grades || grades.length === 0) {
    return '';
  }

  const gradesNormalizadas = grades.map(g => g.trim().toUpperCase()).filter(g => g !== '');
  if (gradesNormalizadas.length === 0) {
    return '';
  }

  if (gradesNormalizadas.length === 1) {
    request.input(`grade${paramSuffix}`, sql.VarChar, gradesNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, ${prefix}.GRADE), '')))) = @grade${paramSuffix}`;
  }

  gradesNormalizadas.forEach((g, index) => {
    request.input(`grade${paramSuffix}${index}`, sql.VarChar, g);
  });

  const placeholders = gradesNormalizadas.map((_, index) => `@grade${paramSuffix}${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, ${prefix}.GRADE), '')))) IN (${placeholders})`;
}

/**
 * Cria filtro de exclusão de linhas para ScarfMe
 * Exclui linhas configuradas em excludedLines da configuração da empresa
 * @param paramPrefix Prefixo único para os parâmetros SQL (para evitar duplicação quando chamado múltiplas vezes)
 */
function buildExclusionFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  prefix: string = 'p',
  paramPrefix: string = 'excludedLine'
): string {
  if (company !== 'scarfme') {
    return '';
  }

  const companyConfig = resolveCompany(company);
  if (!companyConfig || !companyConfig.excludedLines || companyConfig.excludedLines.length === 0) {
    return '';
  }

  const linhasExcluidas = companyConfig.excludedLines.map(l => l.trim().toUpperCase()).filter(l => l !== '');
  if (linhasExcluidas.length === 0) {
    return '';
  }

  // Para ScarfMe, a linha pode estar em p.LINHA ou vp.LINHA (dependendo da query)
  // Vamos criar um filtro que funciona para ambos os casos
  if (linhasExcluidas.length === 1) {
    request.input(paramPrefix, sql.VarChar, linhasExcluidas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) <> @${paramPrefix}`;
  }

  linhasExcluidas.forEach((l, index) => {
    request.input(`${paramPrefix}${index}`, sql.VarChar, l);
  });

  const placeholders = linhasExcluidas.map((_, index) => `@${paramPrefix}${index}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) NOT IN (${placeholders})`;
}

/**
 * Filtro fixo para NERD: contabilizar apenas a linha ELETRONICOS (campo LINHA).
 * Não altera a visão de grupos; aplicado só no backend.
 */
function buildNerdOnlyLinhaEletronicosFilter(company: string | undefined, prefix: string): string {
  if (company !== 'nerd') {
    return '';
  }
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) = 'ELETRONICOS'`;
}

/** Para NERD: exclui categorias BAG e ASSISTENCIA do controle de estoque */
function buildCategoriaExcludeNerd(company: string | undefined, categoriaField: string): string {
  if (company !== 'nerd') return '';
  return `AND LTRIM(RTRIM(${categoriaField})) NOT IN ('BAG', 'ASSISTENCIA')`;
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
  /** Quando true, estoque e custo do card consideram só produtos que venderam no período (range) */
  filtrarEstoquePorGiro?: boolean;
  /** Faixa de giro em dias (30, 60, 90, …). Quando > 30, exclui produtos que venderam em [0, diasInicio] (faixas disjuntas). */
  giroDias?: number;
}

/** Faixas de giro em dias; cada uma é uma janela exclusiva (não sobrepõe a outra). */
const GIRO_BUCKETS = [30, 60, 90, 120, 150, 300] as const;

/** Dias para considerar "obsoleto": sem venda nos últimos 300 dias. */
const GIRO_OBSOLETO_DIAS = 300;

export interface FetchCategoriasComGiroResult {
  chaves: Set<string>;
  produtosPorChave: Map<string, string[]>;
  todosProdutos: Set<string>;
}

/**
 * Busca categorias com produtos em estoque que venderam na faixa de giro selecionada.
 * diasGiro = 0 → faixa OBSOLETO: produtos que NÃO venderam nos últimos 300 dias.
 * Caso contrário, janelas EXCLUSIVAS: 30, 60, 90, 120, 150, 300 dias.
 * Retorna chaves, produtosPorChave (chave -> códigos de produto) e todosProdutos (para detalhado rápido).
 * Usa cache em memória (TTL 5min) para evitar re-executar a CTE com os mesmos parâmetros.
 */
export async function fetchCategoriasComGiro({
  company,
  filial,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
  diasGiro,
}: ControleEstoqueParams & { diasGiro: number }): Promise<FetchCategoriasComGiroResult> {
  const { getGiroCache, setGiroCache } = await import('@/lib/repositories/giroCache');
  const cached = getGiroCache({
    company,
    filial,
    grupos: grupos ?? undefined,
    linhas: linhas ?? undefined,
    colecoes: colecoes ?? undefined,
    subgrupos: subgrupos ?? undefined,
    grades: grades ?? undefined,
    diasGiro,
  });
  if (cached) {
    return {
      chaves: cached.chaves,
      produtosPorChave: cached.produtosPorChave,
      todosProdutos: cached.todosProdutos,
    };
  }

  return withRequest(async (request) => {
    const isObsoleto = diasGiro === 0;

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vg');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineGiro');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    const categoriaField = company === 'nerd'
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // Pré-calcula a última data de venda (com QTDE > 0) por PRODUTO+COR em uma CTE.
    // Giro por cor: só consideramos estoque da cor que vendeu; cores sem venda no período não entram.
    let giroQuery: string;

    if (isObsoleto) {
      request.input('giroObsoletoDias', sql.Int, GIRO_OBSOLETO_DIAS);

      giroQuery = `
      ;WITH UltimaVenda AS (
        SELECT
          vg.PRODUTO,
          ISNULL(vg.COR_PRODUTO, '') AS COR_PRODUTO,
          MAX(vg.DATA_VENDA) AS ultimaVenda
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vg WITH (NOLOCK)
        WHERE vg.QTDE > 0
          ${vendasFilialFilter}
        GROUP BY vg.PRODUTO, ISNULL(vg.COR_PRODUTO, '')
      )
      SELECT DISTINCT
        e.PRODUTO AS produto,
        ISNULL(e.COR_PRODUTO, '') AS cor,
        ${categoriaField} AS categoria,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN UltimaVenda uv ON uv.PRODUTO = e.PRODUTO AND ISNULL(uv.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
      WHERE e.ESTOQUE > 0
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
        AND (
          uv.ultimaVenda IS NULL
          OR uv.ultimaVenda < DATEADD(DAY, -@giroObsoletoDias, CAST(GETDATE() AS DATE))
        )
    `;
    } else {
      const idx = GIRO_BUCKETS.indexOf(diasGiro as (typeof GIRO_BUCKETS)[number]);
      const diasInicio = idx > 0 ? GIRO_BUCKETS[idx - 1] : 0;
      const diasFim = idx >= 0 ? diasGiro : 30;

      request.input('giroDiasInicio', sql.Int, diasInicio);
      request.input('giroDiasFim', sql.Int, diasFim);

      // CTE com a data da última venda por produto+cor.
      // Para faixas exclusivas (ex.: 60d), a condição é:
      //   ultimaVenda entre [hoje - diasFim, hoje - diasInicio)
      giroQuery = `
      ;WITH UltimaVenda AS (
        SELECT
          vg.PRODUTO,
          ISNULL(vg.COR_PRODUTO, '') AS COR_PRODUTO,
          MAX(vg.DATA_VENDA) AS ultimaVenda
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vg WITH (NOLOCK)
        WHERE vg.QTDE > 0
          ${vendasFilialFilter}
        GROUP BY vg.PRODUTO, ISNULL(vg.COR_PRODUTO, '')
      )
      SELECT DISTINCT
        e.PRODUTO AS produto,
        ISNULL(e.COR_PRODUTO, '') AS cor,
        ${categoriaField} AS categoria,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      INNER JOIN UltimaVenda uv ON uv.PRODUTO = e.PRODUTO AND ISNULL(uv.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
      WHERE e.ESTOQUE > 0
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
        ${diasInicio > 0
          ? `AND uv.ultimaVenda >= DATEADD(DAY, -@giroDiasFim, CAST(GETDATE() AS DATE))
             AND uv.ultimaVenda < DATEADD(DAY, -@giroDiasInicio, CAST(GETDATE() AS DATE))`
          : `AND uv.ultimaVenda >= DATEADD(DAY, -@giroDiasFim, CAST(GETDATE() AS DATE))
             AND uv.ultimaVenda < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))`
        }
    `;
    }

    const result = await request.query<{
      produto: string;
      cor?: string;
      categoria: string;
      linha: string;
      subgrupo: string;
      grade: string;
      colecao: string;
    }>(giroQuery);

    const chaves = new Set<string>();
    const produtosPorChave = new Map<string, string[]>();
    const todosProdutos = new Set<string>();

    result.recordset.forEach(row => {
      const chave = `${row.categoria?.trim() || ''}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      chaves.add(chave);
      const produto = (row.produto ?? '').toString().trim();
      const cor = (row.cor ?? '').toString().trim();
      if (produto) {
        const idVariacao = cor ? `${produto}|${cor}` : produto;
        todosProdutos.add(idVariacao);
        const list = produtosPorChave.get(chave) ?? [];
        if (!list.includes(idVariacao)) list.push(idVariacao);
        produtosPorChave.set(chave, list);
      }
    });

    setGiroCache(
      { company, filial, grupos, linhas, colecoes, subgrupos, grades, diasGiro },
      { chaves, produtosPorChave, todosProdutos }
    );

    return { chaves, produtosPorChave, todosProdutos };
  });
}

export interface EstoqueKPI {
  estoqueTotal: number;
  valorEmEstoque: number;
  vendasEsteMes: number;
  categoriasAtivas: number;
  estoqueTotalAnterior: number;
  valorEmEstoqueAnterior: number;
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
  estoqueSemanaPassada: number; // estoque do início do período selecionado (calculado: estoque atual - entradas + vendas + e-commerce)
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
  vendaTotal: number;
  duracao: number;
  prevFimMes: number;
  prevFimAno: number;
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
    // Usar o período selecionado pelo usuário (range) para calcular vendas
    const { start: periodoStartKPI, end: periodoEndKPI } = resolveRange(range);
    
    // Calcular período anterior: mesmos dias do mês anterior
    // Se período atual é 01/01 a 20/01 (inclusivo), período anterior é 01/12 a 20/12 (inclusivo)
    // O periodoEndKPI é exclusivo (21/01), então precisamos calcular corretamente
    // Calcular a duração do período atual em milissegundos
    const duracaoPeriodo = periodoEndKPI.getTime() - periodoStartKPI.getTime();
    
    // Calcular data de início do período anterior (mesmo dia do mês anterior)
    const periodoAnteriorStart = new Date(periodoStartKPI);
    const mesAtual = periodoStartKPI.getUTCMonth();
    if (mesAtual === 0) {
      // Se estamos em janeiro, voltar para dezembro do ano anterior
      periodoAnteriorStart.setUTCFullYear(periodoStartKPI.getUTCFullYear() - 1);
      periodoAnteriorStart.setUTCMonth(11);
    } else {
      periodoAnteriorStart.setUTCMonth(mesAtual - 1);
    }
    
    // Calcular data de fim do período anterior mantendo a mesma duração
    const periodoAnteriorEnd = new Date(periodoAnteriorStart.getTime() + duracaoPeriodo);
    
    // Manter currentMonth apenas para comparação com mês anterior (vendasMesAnterior)
    const now = new Date();
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };
    const previousMonth = shiftRangeByMonths(currentMonth, -1);
    
    const companyConfig = resolveCompany(company);
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineKPI');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

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
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaFieldKPI} <> ''
        AND ${categoriaFieldKPI} <> 'SEM GRUPO'
        AND ${categoriaFieldKPI} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaFieldKPI)}
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

    // Vendas do período selecionado (varejo)
    request.input('periodoStartKPI', sql.DateTime, periodoStartKPI);
    request.input('periodoEndKPI', sql.DateTime, periodoEndKPI);
    
    const vendasAtualQuery = `
      SELECT 
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendasMes
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStartKPI
        AND vp.DATA_VENDA < @periodoEndKPI
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
    `;

    const vendasAtualResult = await request.query<{
      vendasMes: number | null;
    }>(vendasAtualQuery);

    // Buscar vendas de e-commerce do período selecionado (apenas para ScarfMe quando filial é null)
    let ecommerceVendasMes = 0;
    let ecommerceFilialFilter = '';
    const isScarfme = company === 'scarfme';
    const hasEcommerce = (companyConfig?.ecommerceFilials?.length ?? 0) > 0;
    const shouldIncludeEcommerce = isScarfme && hasEcommerce && filial === null;
    
    if (shouldIncludeEcommerce) {
      // Para "Todas as filiais" (null), buscar todas as filiais de e-commerce
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filialEcommerce, index) => {
          request.input(`ecommerceFilialKPI${index}`, sql.VarChar, filialEcommerce);
        });
        const placeholders = ecommerceFilials.map((_, i) => `@ecommerceFilialKPI${i}`).join(', ');
        ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
      }

      if (ecommerceFilialFilter) {
        const ecommerceVendasQuery = `
          SELECT 
            SUM(CAST(fp.QTDE AS FLOAT)) AS vendasMes
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
          WHERE f.EMISSAO >= @periodoStartKPI
            AND f.EMISSAO < @periodoEndKPI
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            ${ecommerceFilialFilter}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${exclusionFilter}
            ${nerdOnlyEletronicosFilter}
        `;

        const ecommerceVendasResult = await request.query<{
          vendasMes: number | null;
        }>(ecommerceVendasQuery);

        ecommerceVendasMes = Number(ecommerceVendasResult.recordset[0]?.vendasMes ?? 0);
      }
    }

    // Vendas do período anterior (com a mesma duração do período selecionado)
    request.input('periodoAnteriorStartKPI', sql.DateTime, periodoAnteriorStart);
    request.input('periodoAnteriorEndKPI', sql.DateTime, periodoAnteriorEnd);
    
    const vendasAnteriorQuery = `
      SELECT 
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendasMes
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoAnteriorStartKPI
        AND vp.DATA_VENDA < @periodoAnteriorEndKPI
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
    `;

    const vendasAnteriorResult = await request.query<{
      vendasMes: number | null;
    }>(vendasAnteriorQuery);

    // Buscar vendas de e-commerce do período anterior (apenas para ScarfMe quando filial é null)
    let ecommerceVendasMesAnterior = 0;
    if (shouldIncludeEcommerce) {
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        const ecommerceFilialFilterAnterior = ecommerceFilialFilter; // Reutilizar o mesmo filtro
        
        const ecommerceVendasAnteriorQuery = `
          SELECT 
            SUM(CAST(fp.QTDE AS FLOAT)) AS vendasMes
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
          WHERE f.EMISSAO >= @periodoAnteriorStartKPI
            AND f.EMISSAO < @periodoAnteriorEndKPI
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            ${ecommerceFilialFilterAnterior}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${exclusionFilter}
            ${nerdOnlyEletronicosFilter}
        `;

        const ecommerceVendasAnteriorResult = await request.query<{
          vendasMes: number | null;
        }>(ecommerceVendasAnteriorQuery);

        ecommerceVendasMesAnterior = Number(ecommerceVendasAnteriorResult.recordset[0]?.vendasMes ?? 0);
      }
    }

    // Calcular estoque anterior usando a mesma lógica dos cards de categorias
    // Estoque Anterior = Estoque Atual - Entradas (período) + Vendas (período) + E-commerce (período)
    // Usar o período selecionado pelo usuário (range) - reutilizar as variáveis já declaradas

    // Buscar entradas do período selecionado (apenas na matriz, excluindo devoluções)
    let matrizFilialFilterKPI = '';
    let lojasFilterSaidasKPI = '';
    
    if (companyConfig) {
      let matrizFiliais: string[] = [];
      if (company === 'scarfme') {
        matrizFiliais = ['SCARF ME - MATRIZ'];
      } else if (company === 'nerd') {
        matrizFiliais = ['NERD'];
      }

      if (matrizFiliais.length > 0) {
        matrizFiliais.forEach((filialMatriz, index) => {
          request.input(`matrizFilialKPI${index}`, sql.VarChar, filialMatriz);
        });
        const placeholders = matrizFiliais.map((_, i) => `@matrizFilialKPI${i}`).join(', ');
        matrizFilialFilterKPI = `AND E.FILIAL IN (${placeholders})`;
      }

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
          request.input(`lojaSaidaKPI${index}`, sql.VarChar, filialLoja);
        });
        const placeholders = lojasNormais.map((_, i) => `@lojaSaidaKPI${i}`).join(', ');
        lojasFilterSaidasKPI = `AND S.FILIAL IN (${placeholders})`;
      }
    }

    request.input('periodoStartKPIEntradas', sql.DateTime, periodoStartKPI);
    request.input('periodoEndKPIEntradas', sql.DateTime, periodoEndKPI);

    // Criar filtros para entradas usando o alias 'pr'
    const grupoFilterEntradasKPI = buildGrupoFilter(request, company, grupos, 'pr');
    const linhaFilterEntradasKPI = buildLinhaFilter(request, company, linhas, 'pr');
    const colecaoFilterEntradasKPI = buildColecaoFilter(request, company, colecoes, 'pr');
    const subgrupoFilterEntradasKPI = buildSubgrupoFilter(request, company, subgrupos, 'pr');
    const gradeFilterEntradasKPI = buildGradeFilter(request, company, grades, 'pr', 'Entradas');
    const exclusionFilterEntradasKPI = buildExclusionFilter(request, company, 'pr', 'excludedLineKPIEntradas');
    const nerdOnlyEletronicosFilterEntradasKPI = buildNerdOnlyLinhaEletronicosFilter(company, 'pr');
    const categoriaFieldEntradasKPI = company === 'nerd' 
      ? 'pr.GRUPO_PRODUTO'
      : 'pr.LINHA';

    const entradasPeriodoQuery = `
      SELECT 
        SUM(CAST(P.QTDE AS FLOAT)) AS entradas,
        SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)) AS valorEntradas
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @periodoStartKPIEntradas
        AND E.EMISSAO < @periodoEndKPIEntradas
        ${matrizFilialFilterKPI}
        ${grupoFilterEntradasKPI}
        ${linhaFilterEntradasKPI}
        ${colecaoFilterEntradasKPI}
        ${subgrupoFilterEntradasKPI}
        ${gradeFilterEntradasKPI}
        ${exclusionFilterEntradasKPI}
        ${nerdOnlyEletronicosFilterEntradasKPI}
        AND ${categoriaFieldEntradasKPI} <> ''
        AND ${categoriaFieldEntradasKPI} <> 'SEM GRUPO'
        AND ${categoriaFieldEntradasKPI} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaFieldEntradasKPI)}
        -- EXCLUIR devoluções/transferências
        AND NOT EXISTS (
          SELECT 1
          FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
          WHERE PS.PRODUTO = P.PRODUTO
            AND ISNULL(PS.COR_PRODUTO, '') = ISNULL(P.COR_PRODUTO, '')
            AND CAST(S.EMISSAO AS DATE) = CAST(E.EMISSAO AS DATE)
            ${lojasFilterSaidasKPI}
        )
    `;

    const entradasPeriodoResult = await request.query<{
      entradas: number | null;
      valorEntradas: number | null;
    }>(entradasPeriodoQuery);

    // Buscar vendas do período selecionado
    const vendasPeriodoQuery = `
      SELECT 
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendas,
        SUM((vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) * ISNULL(p.CUSTO_REPOSICAO1, 0)) AS valorVendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStartKPI
        AND vp.DATA_VENDA < @periodoEndKPI
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaFieldKPI} <> ''
        AND ${categoriaFieldKPI} <> 'SEM GRUPO'
        AND ${categoriaFieldKPI} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaFieldKPI)}
    `;

    const vendasPeriodoResult = await request.query<{
      vendas: number | null;
      valorVendas: number | null;
    }>(vendasPeriodoQuery);

    // Buscar e-commerce do período selecionado (apenas para ScarfMe)
    // Usar a mesma lógica das categorias individuais para garantir consistência
    let ecommercePeriodo = 0;
    let valorEcommercePeriodo = 0;
    if (company === 'scarfme') {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
        let ecommerceFilialFilterKPI = '';
        
        // Aplicar a mesma lógica de filtro de filial das categorias individuais
        if (filial && filial !== VAREJO_VALUE) {
          // Se uma filial específica foi selecionada, usar apenas ela (se for e-commerce)
          if (ecommerceFilials.includes(filial)) {
            request.input('ecommercePeriodoFilialKPI', sql.VarChar, filial);
            ecommerceFilialFilterKPI = `AND f.FILIAL = @ecommercePeriodoFilialKPI`;
          } else {
            // Se a filial selecionada não é e-commerce, não incluir e-commerce
            ecommerceFilialFilterKPI = `AND 1=0`; // Sempre falso
          }
        } else if (filial === VAREJO_VALUE) {
          // Se for "VAREJO", não incluir e-commerce
          ecommerceFilialFilterKPI = `AND 1=0`; // Sempre falso
        } else if (filial === null) {
          // Se for "Todas as filiais", incluir todas as filiais de e-commerce
          if (ecommerceFilials.length > 0) {
            ecommerceFilials.forEach((f, index) => {
              request.input(`ecommercePeriodoFilialKPI${index}`, sql.VarChar, f);
            });
            const placeholders = ecommerceFilials.map((_, i) => `@ecommercePeriodoFilialKPI${i}`).join(', ');
            ecommerceFilialFilterKPI = `AND f.FILIAL IN (${placeholders})`;
          }
        }
        
        if (ecommerceFilialFilterKPI && !ecommerceFilialFilterKPI.includes('1=0')) {
          request.input('periodoStartKPIEcommerce', sql.DateTime, periodoStartKPI);
          request.input('periodoEndKPIEcommerce', sql.DateTime, periodoEndKPI);
          const ecommercePeriodoQuery = `
            SELECT 
              SUM(CAST(fp.QTDE AS FLOAT)) AS ecommerce,
              SUM(CAST(fp.QTDE AS FLOAT) * ISNULL(p.CUSTO_REPOSICAO1, 0)) AS valorEcommerce
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
              ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            WHERE f.EMISSAO >= @periodoStartKPIEcommerce
              AND f.EMISSAO < @periodoEndKPIEcommerce
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND CAST(fp.QTDE AS FLOAT) > 0
              ${ecommerceFilialFilterKPI}
              ${grupoFilter}
              ${linhaFilter}
              ${colecaoFilter}
              ${subgrupoFilter}
              ${gradeFilter}
              ${exclusionFilter}
              AND ${categoriaFieldKPI} <> ''
              AND ${categoriaFieldKPI} <> 'SEM GRUPO'
              AND ${categoriaFieldKPI} <> 'SEM LINHA'
              ${buildCategoriaExcludeNerd(company, categoriaFieldKPI)}
          `;

          const ecommercePeriodoResult = await request.query<{
            ecommerce: number | null;
            valorEcommerce: number | null;
          }>(ecommercePeriodoQuery);

          ecommercePeriodo = Number(ecommercePeriodoResult.recordset[0]?.ecommerce ?? 0);
          valorEcommercePeriodo = Number(ecommercePeriodoResult.recordset[0]?.valorEcommerce ?? 0);
        }
      }
    }

    const entradasPeriodo = Number(entradasPeriodoResult.recordset[0]?.entradas ?? 0);
    const valorEntradasPeriodo = Number(entradasPeriodoResult.recordset[0]?.valorEntradas ?? 0);
    const vendasPeriodo = Number(vendasPeriodoResult.recordset[0]?.vendas ?? 0);
    const valorVendasPeriodo = Number(vendasPeriodoResult.recordset[0]?.valorVendas ?? 0);
    const estoqueAtual = Number(estoqueRow.estoqueTotal ?? 0);

    // IMPORTANTE: Calcular estoque anterior usando EXATAMENTE a mesma fórmula das categorias individuais
    // Fórmula: Estoque Período Anterior = Estoque Atual - Entradas na Matriz (período) + Vendas (período) + E-commerce (período)
    // As variáveis entradasPeriodo, vendasPeriodo e ecommercePeriodo já foram calculadas com os mesmos filtros
    // que as categorias individuais usam (incluindo filtro de categoria)
    const estoqueAnterior = Math.max(0, Math.round(
      estoqueAtual - entradasPeriodo + vendasPeriodo + ecommercePeriodo
    ));

    // Calcular valor em estoque anterior usando a mesma fórmula do estoque total
    // Fórmula: Valor em Estoque Anterior = Valor em Estoque Atual - Valor Entradas (período) + Valor Vendas (período) + Valor E-commerce (período)
    const valorEmEstoqueAtual = Number(estoqueRow.valorTotal ?? 0);
    const valorEmEstoqueAnterior = Math.max(0, 
      valorEmEstoqueAtual - valorEntradasPeriodo + valorVendasPeriodo + valorEcommercePeriodo
    );

    // Somar vendas de varejo + e-commerce
    const vendasVarejoMes = Math.round(Number(vendasAtualResult.recordset[0]?.vendasMes ?? 0));
    const vendasVarejoMesAnterior = Math.round(Number(vendasAnteriorResult.recordset[0]?.vendasMes ?? 0));
    
    const vendasTotalMes = vendasVarejoMes + ecommerceVendasMes;
    const vendasTotalMesAnterior = vendasVarejoMesAnterior + ecommerceVendasMesAnterior;

    return {
      estoqueTotal: Math.round(estoqueAtual),
      valorEmEstoque: valorEmEstoqueAtual,
      vendasEsteMes: vendasTotalMes,
      categoriasAtivas: Number(estoqueRow.categoriasAtivas ?? 0),
      estoqueTotalAnterior: estoqueAnterior,
      valorEmEstoqueAnterior: valorEmEstoqueAnterior,
      vendasMesAnterior: vendasTotalMesAnterior,
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
  filtrarEstoquePorGiro = false,
  giroDias,
}: ControleEstoqueParams): Promise<CategoriaEstoque[]> {
  return withRequest(async (request) => {
    const now = new Date();
    const isGiroObsoleto = filtrarEstoquePorGiro && giroDias === 0;
    const idxGiro = typeof giroDias === 'number' && giroDias > 0 ? GIRO_BUCKETS.indexOf(giroDias as (typeof GIRO_BUCKETS)[number]) : -1;
    const diasInicioGiro = idxGiro > 0 ? GIRO_BUCKETS[idxGiro - 1] : 0;
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1; // 1-12
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1), // Início do próximo mês (exclusivo)
    };

    const { start: periodoStart, end: periodoEnd } = resolveRange(range);
    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineCategoria');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

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

    // Quando giro ativo: só somar estoque de produtos que venderam no período (card = resultado final).
    // Faixa Obsoleto (giroDias=0): só NOT EXISTS (venda nos últimos 300 dias).
    // Faixas disjuntas: se giroDias > 30 (ex.: 60), excluir produtos que venderam em [0, diasInicio] para não duplicar.
    //
    // OTIMIZAÇÃO: Em vez de EXISTS/NOT EXISTS correlacionados inline (O(N) seeks),
    // usamos um CTE pre-materializado com MAX(DATA_VENDA) por PRODUTO + JOIN.
    // O filtroGiroEstoque agora é uma condição simples no WHERE sobre o campo uv.ultimaVenda.
    // O CTE (giroCtePreamble) é injetado antes do SELECT principal.
    if (filtrarEstoquePorGiro && diasInicioGiro > 0) {
      request.input('giroExcluirDias', sql.Int, diasInicioGiro);
    }
    if (isGiroObsoleto) {
      request.input('giroObsoletoDiasCat', sql.Int, GIRO_OBSOLETO_DIAS);
    }

    // Determinar se precisamos do CTE de giro
    const needsGiroCte = filtrarEstoquePorGiro && vendasGlobaisFilter;

    // Preamble CTE: calcula MAX(DATA_VENDA) por produto+cor (giro por cor: só entra estoque da cor que vendeu)
    const giroCtePreamble = needsGiroCte
      ? `;WITH GiroUltimaVenda AS (
          SELECT
            vp.PRODUTO,
            ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
            MAX(vp.DATA_VENDA) AS ultimaVenda
          FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
          WHERE vp.QTDE > 0
            ${vendasGlobaisFilter}
          GROUP BY vp.PRODUTO, ISNULL(vp.COR_PRODUTO, '')
        )`
      : '';

    // JOIN adicional: por produto e cor
    const giroJoinClause = needsGiroCte
      ? isGiroObsoleto
        ? `LEFT JOIN GiroUltimaVenda guv ON guv.PRODUTO = e.PRODUTO AND ISNULL(guv.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')`
        : `INNER JOIN GiroUltimaVenda guv ON guv.PRODUTO = e.PRODUTO AND ISNULL(guv.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')`
      : '';

    // Condição WHERE simples em vez de subqueries correlacionadas
    const filtroGiroEstoque = needsGiroCte
      ? isGiroObsoleto
        ? ` AND (
              guv.ultimaVenda IS NULL
              OR guv.ultimaVenda < DATEADD(DAY, -@giroObsoletoDiasCat, CAST(GETDATE() AS DATE))
            )`
        : diasInicioGiro > 0
          ? ` AND guv.ultimaVenda >= @periodoStart
              AND guv.ultimaVenda < @periodoEnd
              AND guv.ultimaVenda < DATEADD(DAY, -@giroExcluirDias, CAST(GETDATE() AS DATE))`
          : ` AND guv.ultimaVenda >= @periodoStart
              AND guv.ultimaVenda < @periodoEnd`
      : '';

    const estoqueQuery = `
      ${giroCtePreamble}
      SELECT 
        ${categoriaField} AS categoria
        ${camposAdicionais},
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueAtual,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      ${giroJoinClause}
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
        ${filtroGiroEstoque}
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
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        -- NÃO aplicar linhaFilter, colecaoFilter, subgrupoFilter, gradeFilter aqui
        -- para não perder vendas que pertencem à categoria
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByVendasAdicional}, YEAR(vp.DATA_VENDA), MONTH(vp.DATA_VENDA)
    `;

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
          ${exclusionFilter}
          ${nerdOnlyEletronicosFilter}
          -- NÃO aplicar linhaFilter, colecaoFilter, subgrupoFilter, gradeFilter aqui
          -- para não perder vendas que pertencem à categoria
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
          ${buildCategoriaExcludeNerd(company, categoriaField)}
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
    
    // Pré-calcular datas necessárias para a query consolidada de vendas
    const ultimos30DiasStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const hoje = new Date(now.getTime());
    hoje.setHours(23, 59, 59, 999);
    const previousMonth = shiftRangeByMonths(currentMonth, -1);
    
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
    // Criar novo filtro de exclusão para entradas com prefixo único
    const exclusionFilterEntradas = buildExclusionFilter(request, company, 'pr', 'excludedLineCategoriaEntradas');
    const nerdOnlyEletronicosFilterEntradas = buildNerdOnlyLinhaEletronicosFilter(company, 'pr');

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

    // Buscar entradas do período selecionado
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
        ${exclusionFilterEntradas}
        ${nerdOnlyEletronicosFilterEntradas}
        AND ${categoriaFieldEntradas} <> ''
        AND ${categoriaFieldEntradas} <> 'SEM GRUPO'
        AND ${categoriaFieldEntradas} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaFieldEntradas)}
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

    // Buscar vendas do período selecionado (já usa vendasFilialFilter que foi criado anteriormente)
    // ============================================
    // OTIMIZAÇÃO: CONSOLIDAR 4 queries de vendas em 1 única query
    // ============================================
    // Antes: 4 queries sequenciais (vendasSemana, vendasPeriodoAnterior, vendasMesAnterior, vendasUltimos30Dias)
    // Agora: 1 query com CASE WHEN que classifica cada venda nos buckets corretos.
    // Usa o range mais amplo possível e filtra internamente via CASE WHEN.
    // Reduz de 4 roundtrips para 1, cortando ~75% da latência de rede + compilação SQL.
    
    // Calcular o range mais amplo que cobre todos os períodos
    const allDates = [periodoStart, periodoEnd, periodoAnteriorStart, periodoAnteriorEnd, previousMonth.start, previousMonth.end, ultimos30DiasStart, now];
    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
    
    request.input('vendasConsolidadaMin', sql.DateTime, minDate);
    request.input('vendasConsolidadaMax', sql.DateTime, maxDate);
    request.input('vcPeriodoStart', sql.DateTime, periodoStart);
    request.input('vcPeriodoEnd', sql.DateTime, periodoEnd);
    request.input('vcAnteriorStart', sql.DateTime, periodoAnteriorStart);
    request.input('vcAnteriorEnd', sql.DateTime, periodoAnteriorEnd);
    request.input('vcPrevMonthStart', sql.DateTime, previousMonth.start);
    request.input('vcPrevMonthEnd', sql.DateTime, previousMonth.end);
    request.input('vcUlt30Start', sql.DateTime, ultimos30DiasStart);
    request.input('vcUlt30End', sql.DateTime, now);
    
    const vendasConsolidadaQuery = `
      SELECT 
        ${categoriaField} AS categoria
        ${camposVendasAdicionais},
        SUM(CASE WHEN vp.DATA_VENDA >= @vcPeriodoStart AND vp.DATA_VENDA < @vcPeriodoEnd AND vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasPeriodo,
        SUM(CASE WHEN vp.DATA_VENDA >= @vcAnteriorStart AND vp.DATA_VENDA < @vcAnteriorEnd AND vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasAnterior,
        SUM(CASE WHEN vp.DATA_VENDA >= @vcPrevMonthStart AND vp.DATA_VENDA < @vcPrevMonthEnd AND vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendasMesAnterior,
        SUM(CASE WHEN vp.DATA_VENDA >= @vcUlt30Start AND vp.DATA_VENDA < @vcUlt30End AND vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas30Dias
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @vendasConsolidadaMin
        AND vp.DATA_VENDA < @vendasConsolidadaMax
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByVendasAdicional}
    `;

    const vendasConsolidadaResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendasPeriodo: number | null;
      vendasAnterior: number | null;
      vendasMesAnterior: number | null;
      vendas30Dias: number | null;
    }>(vendasConsolidadaQuery);

    // Desempacotar resultados consolidados nos 4 maps que o restante do código espera
    const vendasSemanaMap = new Map<string, number>();
    const vendasPeriodoAnteriorMap = new Map<string, number>();
    const vendasMesAnteriorMap = new Map<string, number>();
    const vendasUltimos30DiasMap = new Map<string, number>();

    vendasConsolidadaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      
      const vp = Number(row.vendasPeriodo ?? 0);
      const va = Number(row.vendasAnterior ?? 0);
      const vma = Number(row.vendasMesAnterior ?? 0);
      const v30 = Number(row.vendas30Dias ?? 0);
      
      if (vp > 0) vendasSemanaMap.set(chaveCategoria, vp);
      if (va > 0) vendasPeriodoAnteriorMap.set(chaveCategoria, va);
      if (vma > 0) vendasMesAnteriorMap.set(chaveCategoria, vma);
      if (v30 > 0) vendasUltimos30DiasMap.set(chaveCategoria, v30);
    });

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

    // Buscar e-commerce do período selecionado (apenas para ScarfMe)
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
          ${exclusionFilter}
          ${nerdOnlyEletronicosFilter}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
          ${buildCategoriaExcludeNerd(company, categoriaField)}
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

    // vendasSemanaMap, vendasPeriodoAnteriorMap, vendasMesAnteriorMap, vendasUltimos30DiasMap
    // já foram preenchidos pela query consolidada acima

    const ecommerceSemanaMap = new Map<string, number>();
    ecommerceSemanaResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      ecommerceSemanaMap.set(chaveCategoria, Number(row.ecommerce ?? 0));
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
      
      // FALLBACK: Se estivermos nos primeiros 5 dias do mês, usar média do mês anterior ou últimos 30 dias
      let vendasParaProjecao = vendasMesAtual;
      let diasParaProjecao = currentDay;
      
      if (currentDay <= 5 && vendasMesAtual === 0) {
        // Tentar usar vendas do mês anterior primeiro
        const vendasMesAnterior = vendasMesAnteriorMap.get(chaveCategoria) || 0;
        const daysInPreviousMonth = new Date(previousMonth.end.getTime() - 1).getDate();
        
        if (vendasMesAnterior > 0) {
          // Usar média diária do mês anterior
          const mediaDiariaMesAnterior = vendasMesAnterior / daysInPreviousMonth;
          vendasParaProjecao = mediaDiariaMesAnterior * currentDay;
          diasParaProjecao = currentDay;
        } else {
          // Se não houver vendas no mês anterior, tentar últimos 30 dias
          const vendas30Dias = vendasUltimos30DiasMap.get(chaveCategoria) || 0;
          if (vendas30Dias > 0) {
            // Usar média diária dos últimos 30 dias
            const mediaDiaria30Dias = vendas30Dias / 30;
            vendasParaProjecao = mediaDiaria30Dias * currentDay;
            diasParaProjecao = currentDay;
          }
        }
      } else if (currentDay <= 5 && vendasMesAtual > 0) {
        // Se temos algumas vendas mas ainda estamos nos primeiros 5 dias,
        // usar uma média ponderada: 70% do mês anterior + 30% do mês atual
        const vendasMesAnterior = vendasMesAnteriorMap.get(chaveCategoria) || 0;
        const daysInPreviousMonth = new Date(previousMonth.end.getTime() - 1).getDate();
        
        if (vendasMesAnterior > 0) {
          const mediaDiariaMesAnterior = vendasMesAnterior / daysInPreviousMonth;
          const mediaDiariaMesAtual = vendasMesAtual / currentDay;
          // Média ponderada: 70% mês anterior, 30% mês atual
          const mediaPonderada = (mediaDiariaMesAnterior * 0.7) + (mediaDiariaMesAtual * 0.3);
          vendasParaProjecao = mediaPonderada * currentDay;
          diasParaProjecao = currentDay;
        }
      }
      
      // Projeção baseada na performance (mês atual ou fallback)
      const projecaoMensal = diasParaProjecao > 0 
        ? Math.round((vendasParaProjecao / diasParaProjecao) * daysInMonth) 
        : 0;
      
      // Calcular vendas restantes do mês (apenas o que falta vender)
      // Dias restantes = total de dias do mês - dia atual
      const diasRestantes = daysInMonth - currentDay;
      const projecaoVendasRestantes = diasParaProjecao > 0 && diasRestantes > 0
        ? Math.round((vendasParaProjecao / diasParaProjecao) * diasRestantes)
        : 0;
      
      // Calcular projeção anual corretamente
      // IMPORTANTE: Não podemos multiplicar projecaoMensal pelos meses restantes,
      // porque projecaoMensal é do mês INTEIRO e já vendemos parte do mês atual
      // Exemplo: Se estamos em 20/01, devemos usar:
      // - Vendas restantes de janeiro (11 dias): projecaoVendasRestantes
      // - Vendas dos próximos 11 meses completos (fev a dez): projecaoMensal * 11
      const mesesCompletosRestantes = 12 - (now.getMonth() + 1); // Meses após o mês atual
      const projecaoAnual = projecaoVendasRestantes + (projecaoMensal * mesesCompletosRestantes);
      
      // Duração do estoque baseada na projeção mensal
      const diasEstoque = projecaoMensal > 0 
        ? Math.round((estoqueAtual / projecaoMensal) * 30) 
        : 999;

      // Calcular Estoque Final Mês = Estoque Atual - Vendas Restantes do Mês
      // IMPORTANTE: Subtrair apenas o que falta vender, não o mês inteiro
      const estoqueFinalMes = Math.round(estoqueAtual - projecaoVendasRestantes);

      // Calcular Estoque Final Ano = Estoque Atual - Projeção dos Meses Restantes
      // IMPORTANTE: Multiplicar pelos meses restantes, não por 12
      const estoqueFinalAno = Math.round(estoqueAtual - projecaoAnual);

      // Calcular estoque do período anterior
      // IMPORTANTE: entradasSemana agora contém apenas entradas na matriz (compras reais)
      // Transferências para lojas são movimentações internas e não alteram o estoque total
      // Estoque Período Anterior = Estoque Atual - Entradas na Matriz (período) + Vendas (período) + E-commerce (período)
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
    const companyConfig = resolveCompany(company);
    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    // Para ScarfMe com filial null (Todas as filiais), garantir que inclui e-commerce
    // O buildFilialFilter já inclui todas as filiais quando filial === null para ScarfMe
    // que inclui as filiais normais + e-commerce (se estiverem em filialFilters['inventory'])
    // Mas vamos garantir que está funcionando corretamente
    
    // Buscar categorias principais (já inclui e-commerce quando filial === null para ScarfMe)
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
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
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
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'prd');

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
        ${nerdOnlyEletronicosFilter}
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
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');
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
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      
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
        ${buildCategoriaExcludeNerd(company, categoriaField)}
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
        ${buildCategoriaExcludeNerd(company, categoriaField)}
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
 * Busca dados de vendas por categoria (varejo + e-commerce, mesma regra dos cards)
 * Inclui exclusionFilter igual aos KPIs para o total bater com o card "Vendas"
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
    const { start: periodoStart, end: periodoEnd } = resolveRange(range);
    const companyConfig = resolveCompany(company);
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineVendasCat');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    const query = `
      SELECT 
        ${categoriaField} AS categoria,
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
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) > 0
      ORDER BY vendas DESC
    `;

    const result = await request.query<{
      categoria: string;
      vendas: number | null;
    }>(query);

    const vendasPorCategoria = new Map<string, number>();
    result.recordset.forEach(row => {
      const cat = row.categoria?.trim() || '';
      vendasPorCategoria.set(cat, Math.round(Number(row.vendas ?? 0)));
    });

    // E-commerce do período: mesma regra dos cards (ScarfMe quando "Todas as filiais")
    const shouldIncludeEcommerce = company === 'scarfme' && (filial === null || filial === undefined) && companyConfig && (companyConfig.ecommerceFilials?.length ?? 0) > 0;
    if (shouldIncludeEcommerce) {
      const ecommerceFilials = companyConfig!.ecommerceFilials ?? [];
      ecommerceFilials.forEach((f, index) => {
        request.input(`ecommerceVendasCatFilial${index}`, sql.VarChar, f);
      });
      const placeholders = ecommerceFilials.map((_, i) => `@ecommerceVendasCatFilial${i}`).join(', ');
      const ecommerceQuery = `
        SELECT 
          ${categoriaField} AS categoria,
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
          AND f.FILIAL IN (${placeholders})
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${exclusionFilter}
          ${nerdOnlyEletronicosFilter}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
          ${buildCategoriaExcludeNerd(company, categoriaField)}
        GROUP BY ${categoriaField}
      `;
      const ecommerceResult = await request.query<{ categoria: string; vendas: number | null }>(ecommerceQuery);
      ecommerceResult.recordset.forEach(row => {
        const cat = row.categoria?.trim() || '';
        const v = Math.round(Number(row.vendas ?? 0));
        vendasPorCategoria.set(cat, (vendasPorCategoria.get(cat) ?? 0) + v);
      });
    }

    return Array.from(vendasPorCategoria.entries())
      .map(([categoria, vendas]) => ({ categoria, vendas }))
      .sort((a, b) => b.vendas - a.vendas);
  });
}

/**
 * Busca vendas por categoria para Controle de Giro (com detalhes e usando período selecionado)
 * Inclui vendas de varejo e ecommerce
 */
export async function fetchVendasPorCategoriaGiro({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<Array<{
  categoria: string;
  vendas: number;
  vendasVarejo: number;
  vendasEcommerce: number;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
}>> {
  return withRequest(async (request) => {
    const { start: periodoStart, end: periodoEnd } = resolveRange(range);
    
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineGiro');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');
    const categoriaField = company === 'nerd' 
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    // Determinar se devemos mostrar detalhes (quando há filtros selecionados ou linhas para expandir)
    // Para SCARFME: mostrar subgrupos quando há linhas selecionadas (expansão)
    // Se há apenas linhas (expansão), mostrar apenas subgrupo (sem grade/coleção)
    // Se há outros filtros, mostrar todos os detalhes
    const apenasExpansaoSubgrupo = company === 'scarfme' && 
      (linhas && linhas.length > 0) && 
      !(colecoes && colecoes.length > 0) && 
      !(subgrupos && subgrupos.length > 0) && 
      !(grades && grades.length > 0);
    
    const mostrarDetalhes = (company === 'scarfme' && (
      (linhas && linhas.length > 0) || // Linhas selecionadas = expansão para subgrupos
      (colecoes && colecoes.length > 0) || 
      (subgrupos && subgrupos.length > 0) || 
      (grades && grades.length > 0)
    )) || (company === 'nerd' && (
      (subgrupos && subgrupos.length > 0) || 
      (grades && grades.length > 0) ||
      (colecoes && colecoes.length > 0)
    ));

    // Incluir campos detalhados
    // Se é apenas expansão de subgrupo, mostrar apenas subgrupo
    // Caso contrário, mostrar todos os detalhes
    const camposAdicionais = mostrarDetalhes
      ? (apenasExpansaoSubgrupo
          ? `, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo`
          : (company === 'scarfme'
              ? `, ISNULL(p.LINHA, '') AS linha, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`
              : `, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`))
      : '';
    
    const groupByAdicional = mostrarDetalhes
      ? (apenasExpansaoSubgrupo
          ? `, ISNULL(p.SUBGRUPO_PRODUTO, '')`
          : (company === 'scarfme'
              ? `, ISNULL(p.LINHA, ''), ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`
              : `, ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`))
      : '';

    // Buscar vendas de varejo usando a tabela bruta LOJA_VENDA_PRODUTO
    // Seguindo a mesma lógica do exportar_todos_relatorios.py para garantir consistência
    // Ajustar o filtro de filial: buildVendasFilialFilter gera "vp.FILIAL" mas a tabela bruta não tem essa coluna
    // Precisamos usar "f.FILIAL" (nome da filial) após o JOIN com FILIAIS
    const vendasFilialFilterAjustado = vendasFilialFilter.replace(/vp\.FILIAL/g, 'f.FILIAL');
    
    const queryVarejo = `
      WITH VendasBase AS (
        SELECT 
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.DATA_VENDA,
          vp.PRODUTO,
          vp.COR_PRODUTO,
          vp.TAMANHO,
          vp.QTDE,
          vp.QTDE_CANCELADA,
          f.FILIAL,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          p.COLECAO,
          p.GRADE,
          p.GRIFFE
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) 
          ON p.PRODUTO = vp.PRODUTO
        WHERE vp.DATA_VENDA >= @periodoStart
          AND vp.DATA_VENDA < @periodoEnd
          AND vp.QTDE > 0
          ${vendasFilialFilterAjustado}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${exclusionFilter}
          ${nerdOnlyEletronicosFilter}
      ),
      TrocasItem AS (
        SELECT 
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          vt.COR_PRODUTO,
          vt.TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        WHERE vt.QTDE_CANCELADA = 0
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
      ),
      VendasComNumero AS (
        SELECT 
          vb.*,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM VendasBase vb
      ),
      VendasComTrocas AS (
        SELECT 
          vcn.*,
          CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA
        FROM VendasComNumero vcn
        LEFT JOIN TrocasItem ti ON ti.TICKET = vcn.TICKET 
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
      )
      SELECT 
        ${company === 'nerd' ? 'ISNULL(vct.GRUPO_PRODUTO, \'SEM GRUPO\')' : 'ISNULL(vct.LINHA, \'SEM LINHA\')'} AS categoria${camposAdicionais.replace(/p\./g, 'vct.')},
        SUM(CASE 
          WHEN vct.QTDE_CANCELADA = 0 THEN (vct.QTDE - vct.QTDE_TROCA)
          ELSE 0 
        END) AS vendas
      FROM VendasComTrocas vct
      WHERE ${company === 'nerd' ? 'ISNULL(vct.GRUPO_PRODUTO, \'SEM GRUPO\')' : 'ISNULL(vct.LINHA, \'SEM LINHA\')'} <> ''
        AND ${company === 'nerd' ? 'ISNULL(vct.GRUPO_PRODUTO, \'SEM GRUPO\')' : 'ISNULL(vct.LINHA, \'SEM LINHA\')'} <> 'SEM GRUPO'
        AND ${company === 'nerd' ? 'ISNULL(vct.GRUPO_PRODUTO, \'SEM GRUPO\')' : 'ISNULL(vct.LINHA, \'SEM LINHA\')'} <> 'SEM LINHA'
        ${company === 'nerd' ? `AND LTRIM(RTRIM(ISNULL(vct.GRUPO_PRODUTO, 'SEM GRUPO'))) NOT IN ('BAG', 'ASSISTENCIA')` : ''}
        ${company === 'nerd' ? `AND UPPER(LTRIM(RTRIM(ISNULL(vct.LINHA, '')))) = 'ELETRONICOS'` : ''}
      GROUP BY ${company === 'nerd' ? 'ISNULL(vct.GRUPO_PRODUTO, \'SEM GRUPO\')' : 'ISNULL(vct.LINHA, \'SEM LINHA\')'}${groupByAdicional.replace(/p\./g, 'vct.')}
      HAVING SUM(CASE 
        WHEN vct.QTDE_CANCELADA = 0 THEN (vct.QTDE - vct.QTDE_TROCA)
        ELSE 0 
      END) > 0
    `;

    const resultVarejo = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendas: number | null;
    }>(queryVarejo);

    // Criar filtro de filial para e-commerce com a mesma lógica usada em outras funções
    let ecommerceFilialFilter = '';
    if (company === 'scarfme') {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const isScarfme = company === 'scarfme';
        const filiais = companyConfig.filialFilters['inventory'] ?? [];
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

        // Se uma filial específica foi selecionada, usar apenas ela (se for e-commerce)
        if (filial && filial !== VAREJO_VALUE) {
          if (ecommerceFilials.includes(filial)) {
            request.input('ecommerceGiroFilial', sql.VarChar, filial);
            ecommerceFilialFilter = `AND f.FILIAL = @ecommerceGiroFilial`;
          } else {
            // Se a filial selecionada não é e-commerce, não incluir e-commerce
            ecommerceFilialFilter = `AND 1=0`; // Sempre falso
          }
        }
        // Para scarfme: se for "VAREJO", não incluir e-commerce
        else if (isScarfme && filial === VAREJO_VALUE) {
          ecommerceFilialFilter = `AND 1=0`; // Sempre falso
        }
        // Para scarfme: se for "Todas as filiais" (null), incluir todas as filiais de e-commerce
        else if (isScarfme && filial === null) {
          if (ecommerceFilials.length > 0) {
            ecommerceFilials.forEach((f, index) => {
              request.input(`ecommerceGiroFilial${index}`, sql.VarChar, f);
            });
            const placeholders = ecommerceFilials.map((_, i) => `@ecommerceGiroFilial${i}`).join(', ');
            ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
          }
        }
      }
    }

    // Buscar vendas de ecommerce (apenas para ScarfMe quando aplicável)
    let resultEcommerce: { recordset: Array<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendas: number | null;
    }> } = { recordset: [] };

    if (company === 'scarfme' && ecommerceFilialFilter && !ecommerceFilialFilter.includes('1=0')) {
      const queryEcommerce = `
        SELECT 
          ${categoriaField} AS categoria${camposAdicionais},
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
          ${ecommerceFilialFilter}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${exclusionFilter}
          ${nerdOnlyEletronicosFilter}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
          ${buildCategoriaExcludeNerd(company, categoriaField)}
        GROUP BY ${categoriaField}${groupByAdicional}
        HAVING SUM(CAST(fp.QTDE AS FLOAT)) > 0
      `;

      resultEcommerce = await request.query<{
        categoria: string;
        linha?: string;
        subgrupo?: string;
        grade?: string;
        colecao?: string;
        vendas: number | null;
      }>(queryEcommerce);
    }

    // Agregar vendas de varejo e ecommerce por categoria
    const vendasMap = new Map<string, {
      categoria: string;
      vendas: number;
      vendasVarejo: number;
      vendasEcommerce: number;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
    }>();

    // Adicionar vendas de varejo
    resultVarejo.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      const vendas = Math.round(Number(row.vendas ?? 0));

      if (vendasMap.has(chave)) {
        const item = vendasMap.get(chave)!;
        item.vendasVarejo += vendas;
        item.vendas += vendas;
      } else {
        vendasMap.set(chave, {
          categoria,
          vendas,
          vendasVarejo: vendas,
          vendasEcommerce: 0,
          linha: linha || undefined,
          subgrupo: subgrupo || undefined,
          grade: grade || undefined,
          colecao: colecao || undefined,
        });
      }
    });

    // Adicionar vendas de ecommerce
    resultEcommerce.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      const linha = row.linha?.trim() || '';
      const subgrupo = row.subgrupo?.trim() || '';
      const grade = row.grade?.trim() || '';
      const colecao = row.colecao?.trim() || '';
      const chave = `${categoria}|${linha}|${subgrupo}|${grade}|${colecao}`;
      const vendas = Math.round(Number(row.vendas ?? 0));

      if (vendasMap.has(chave)) {
        const item = vendasMap.get(chave)!;
        item.vendasEcommerce += vendas;
        item.vendas += vendas;
      } else {
        vendasMap.set(chave, {
          categoria,
          vendas,
          vendasVarejo: 0,
          vendasEcommerce: vendas,
          linha: linha || undefined,
          subgrupo: subgrupo || undefined,
          grade: grade || undefined,
          colecao: colecao || undefined,
        });
      }
    });

    // Converter mapa para array e ordenar por vendas (decrescente)
    return Array.from(vendasMap.values())
      .filter(item => item.vendas > 0)
      .sort((a, b) => b.vendas - a.vendas);
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
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');
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
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
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

    // Resolver período do range selecionado
    const { start: periodoStart, end: periodoEnd } = resolveRange(range);
    
    // Buscar vendas reais do período selecionado para calcular vendaTotal
    const vendasPeriodoQuery = `
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
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByVendasAdicional}
    `;

    request.input('periodoStart', sql.DateTime, periodoStart);
    request.input('periodoEnd', sql.DateTime, periodoEnd);

    const vendasPeriodoResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      vendas: number | null;
    }>(vendasPeriodoQuery);

    // Agrupar vendas totais por categoria (varejo)
    const vendasPorCategoria = new Map<string, number>();
    vendasPeriodoResult.recordset.forEach(row => {
      const categoria = row.categoria?.trim() || '';
      // SEMPRE usar chave detalhada para manter consistência
      const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
      const vendas = Number(row.vendas ?? 0);
      vendasPorCategoria.set(chaveCategoria, (vendasPorCategoria.get(chaveCategoria) || 0) + vendas);
    });

    // Buscar vendas de e-commerce do período (apenas para ScarfMe)
    let ecommercePeriodoResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; vendas: number | null }> } = { recordset: [] };
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
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${nerdOnlyEletronicosFilter}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
          ${buildCategoriaExcludeNerd(company, categoriaField)}
        GROUP BY ${categoriaField}${groupByVendasAdicional}
      `;

      ecommercePeriodoResult = await request.query<{
        categoria: string;
        linha?: string;
        subgrupo?: string;
        grade?: string;
        colecao?: string;
        vendas: number | null;
      }>(ecommercePeriodoQuery);

      // Adicionar vendas de e-commerce às vendas totais
      ecommercePeriodoResult.recordset.forEach(row => {
        const categoria = row.categoria?.trim() || '';
        // SEMPRE usar chave detalhada para manter consistência
        const chaveCategoria = `${categoria}|${row.linha?.trim() || ''}|${row.subgrupo?.trim() || ''}|${row.grade?.trim() || ''}|${row.colecao?.trim() || ''}`;
        const vendas = Number(row.vendas ?? 0);
        vendasPorCategoria.set(chaveCategoria, (vendasPorCategoria.get(chaveCategoria) || 0) + vendas);
      });
    }

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
        ${buildCategoriaExcludeNerd(company, categoriaField)}
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

      // Criar chave para buscar vendas (SEMPRE usar chave detalhada para manter consistência)
      const chaveCategoria = `${categoria}|${linha || ''}|${subgrupo || ''}|${grade || ''}|${colecao || ''}`;
      
      // Buscar vendas totais do período selecionado
      const vendaTotal = Number(vendasPorCategoria.get(chaveCategoria) || 0);
      
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

      return {
        categoria,
        estoqueAtual: Math.round(estoqueAtual),
        vendaTotal: Math.round(vendaTotal || 0),
        duracao: diasEstoque,
        prevFimMes,
        prevFimAno,
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
  preco: number;
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
  produtoNome?: string;
  linha?: string;
  grupo?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  cor?: string;
  /** Quando informado (ex: giro ativo), usa este período para vendas e retorna só variações que venderam no período */
  startDate?: Date;
  endDate?: Date;
  filtrarApenasComVendas?: boolean;
  /** Faixa de giro em dias (30, 60, 90, …). Quando > 30, exclui produtos que venderam em [0, diasInicio] (faixas disjuntas). */
  giroDias?: number;
  /** Quando presente (ex: do cache/sessionStorage do giro), filtra por estes códigos e pula toda a lógica de giro (CTE/EXISTS/NOT EXISTS). */
  produtosPermitidos?: string[];
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
  startDate: startDateParam,
  endDate: endDateParam,
  filtrarApenasComVendas = false,
  giroDias: giroDiasParam,
  produtosPermitidos: produtosPermitidosParam,
}: ProdutoDetalhesParams): Promise<ProdutoDetalhesCompleto> {
  return withRequest(async (request) => {
    const useProdutosPermitidos = Array.isArray(produtosPermitidosParam) && produtosPermitidosParam.length > 0;
    const now = new Date();
    const idxGiroDetalhe = typeof giroDiasParam === 'number' ? GIRO_BUCKETS.indexOf(giroDiasParam as (typeof GIRO_BUCKETS)[number]) : -1;
    const diasInicioGiroDetalhe = idxGiroDetalhe > 0 ? GIRO_BUCKETS[idxGiroDetalhe - 1] : 0;
    const currentMonth = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
    const startDate = startDateParam ?? currentMonth.start;
    const endDate = endDateParam ?? currentMonth.end;

    request.input('startDate', sql.DateTime, startDate);
    request.input('endDate', sql.DateTime, endDate);

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

    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    // Quando produtosPermitidos vem do cache/sessionStorage do giro: filtra por (PRODUTO, COR) — formato "produto|cor" ou só "produto".
    let produtoFilterPermitidos = '';
    if (useProdutosPermitidos && produtosPermitidosParam) {
      const pares = produtosPermitidosParam.slice(0, 2000).map((s) => {
        const t = String(s).trim();
        const i = t.indexOf('|');
        return i >= 0 ? [t.slice(0, i), t.slice(i + 1)] as [string, string] : [t, ''] as [string, string];
      });
      const orClauses = pares.map(([prod, cor], i) => {
        request.input(`permP${i}`, sql.VarChar, prod);
        request.input(`permC${i}`, sql.VarChar, cor);
        return `(LTRIM(RTRIM(e.PRODUTO)) = @permP${i} AND ISNULL(LTRIM(RTRIM(e.COR_PRODUTO)), '') = @permC${i})`;
      });
      if (orClauses.length > 0) {
        produtoFilterPermitidos = ` AND (${orClauses.join(' OR ')})`;
      }
    }

    // Detalhe por categoria + giro: MESMA regra do card. Obsoleto (giroDiasParam=0): só NOT EXISTS nos últimos 300 dias.
    // Para faixas 60–300d: CTE "produtos que venderam na faixa" + INNER JOIN evita EXISTS por linha (muito mais rápido).
    // Ignorado quando useProdutosPermitidos (detalhado usa lista do cache).
    const detalheCategoriaComGiro = !useProdutosPermitidos && (filtrarApenasComVendas || (startDateParam != null && endDateParam != null)) && company === 'nerd' && grupo && !subgrupo && !grade && !colecao;
    const detalheGiroObsoleto = detalheCategoriaComGiro && giroDiasParam === 0;
    let filtroGiroNaQueryDetalhe = '';
    let useCteGiroDetalhe = false;
    let cteGiroDetalheSql = '';
    let filtroGiroApenasNotExistsDetalhe = '';
    if (detalheCategoriaComGiro && company) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const todasFiliaisVenda = new Set([
          ...(companyConfig.filialFilters['sales'] ?? []),
          ...(companyConfig.ecommerceFilials ?? []),
        ]);
        if (todasFiliaisVenda.size > 0) {
          const arr = Array.from(todasFiliaisVenda);
          arr.forEach((f, i) => request.input(`varGiroFilial${i}`, sql.VarChar, f));
          const ph = arr.map((_, i) => `@varGiroFilial${i}`).join(', ');
          if (detalheGiroObsoleto) {
            request.input('giroObsoletoDiasDetalhe', sql.Int, GIRO_OBSOLETO_DIAS);
            filtroGiroNaQueryDetalhe = ` AND NOT EXISTS (
              SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
              WHERE vp.PRODUTO = e.PRODUTO
                AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
                AND vp.QTDE > 0
                AND vp.DATA_VENDA >= DATEADD(DAY, -@giroObsoletoDiasDetalhe, CAST(GETDATE() AS DATE))
                AND vp.DATA_VENDA < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
                AND vp.FILIAL IN (${ph})
            )`;
          } else {
            if (diasInicioGiroDetalhe > 0) {
              const periodoExcluirStart = new Date(now);
              periodoExcluirStart.setUTCDate(periodoExcluirStart.getUTCDate() - diasInicioGiroDetalhe);
              periodoExcluirStart.setUTCHours(0, 0, 0, 0);
              const periodoExcluirEnd = new Date(now);
              periodoExcluirEnd.setUTCDate(periodoExcluirEnd.getUTCDate() + 1);
              periodoExcluirEnd.setUTCHours(0, 0, 0, 0);
              request.input('periodoExcluirStartDetalhe', sql.DateTime, periodoExcluirStart);
              request.input('periodoExcluirEndDetalhe', sql.DateTime, periodoExcluirEnd);
            }
            useCteGiroDetalhe = true;
            // Duas CTEs: (1) produtos que venderam na faixa [startDate,endDate]; (2) produtos que venderam no período a excluir [0, diasInicio].
            // Anti-join com (2) em vez de NOT EXISTS por linha — uma varredura em vendas por período, sem subquery correlacionada.
            const cteExcluir =
              diasInicioGiroDetalhe > 0
                ? `,
      ProdutosVenderamPeriodoExcluir AS (
        SELECT DISTINCT vp.PRODUTO, ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.QTDE > 0
          AND vp.DATA_VENDA >= @periodoExcluirStartDetalhe
          AND vp.DATA_VENDA < @periodoExcluirEndDetalhe
          AND vp.FILIAL IN (${ph})
      )`
                : '';
            cteGiroDetalheSql = `WITH ProdutosNaFaixaGiro AS (
        SELECT DISTINCT vp.PRODUTO, ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          AND vp.FILIAL IN (${ph})
      )${cteExcluir}
      `;
            // Anti-join por produto+cor
            filtroGiroApenasNotExistsDetalhe =
              diasInicioGiroDetalhe > 0 ? ` AND ex.PRODUTO IS NULL` : '';
            filtroGiroNaQueryDetalhe = ` AND EXISTS (
              SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
              WHERE vp.PRODUTO = e.PRODUTO
                AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
                AND vp.DATA_VENDA >= @startDate
                AND vp.DATA_VENDA < @endDate
                AND vp.QTDE > 0
                AND vp.FILIAL IN (${ph})
            )
            ${diasInicioGiroDetalhe > 0 ? `
            AND NOT EXISTS (
              SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vpExcl WITH (NOLOCK)
              WHERE vpExcl.PRODUTO = e.PRODUTO
                AND ISNULL(vpExcl.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
                AND vpExcl.QTDE > 0
                AND vpExcl.DATA_VENDA >= @periodoExcluirStartDetalhe
                AND vpExcl.DATA_VENDA < @periodoExcluirEndDetalhe
                AND vpExcl.FILIAL IN (${ph})
            )` : ''}`;
          }
        }
      }
    }

    const categoriaFieldDetalhe = company === 'nerd' ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')' : '';
    const excludeNerdDetalhe = company === 'nerd' ? buildCategoriaExcludeNerd(company, categoriaFieldDetalhe) : '';

    // Buscar variações: quando detalhe por categoria + giro, CTE(s) + JOIN. Faixas 60–300d: segunda CTE materializa
    // "produtos que venderam no período a excluir" e anti-join (LEFT JOIN ex WHERE ex.PRODUTO IS NULL) — uma varredura, sem NOT EXISTS por linha.
    const variacoesFromJoin = useCteGiroDetalhe
      ? `FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      INNER JOIN ProdutosNaFaixaGiro g ON g.PRODUTO = e.PRODUTO AND ISNULL(g.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')
      ${diasInicioGiroDetalhe > 0 ? "LEFT JOIN ProdutosVenderamPeriodoExcluir ex ON ex.PRODUTO = e.PRODUTO AND ISNULL(ex.COR_PRODUTO, '') = ISNULL(e.COR_PRODUTO, '')" : ''}
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR`
      : `FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR`;
    const variacoesGiroFilter = useCteGiroDetalhe ? filtroGiroApenasNotExistsDetalhe : filtroGiroNaQueryDetalhe;
    const variacoesQuery = `
      ${useCteGiroDetalhe ? cteGiroDetalheSql : ''}SELECT 
        e.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descricao,
        ${company === 'nerd' ? 'ISNULL(p.GRUPO_PRODUTO, \'\') AS linha,' : 'ISNULL(p.LINHA, \'\') AS linha,'}
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(COALESCE(c.DESC_COR, e.COR_PRODUTO), '') AS cor,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque,
        ISNULL(COALESCE(p.PRECO_REPOSICAO_1, p.PRECO_A_VISTA_REPOSICAO_1, p.REVENDA), 0) AS preco,
        ISNULL(p.CUSTO_REPOSICAO1, 0) AS custoUnitario,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      ${variacoesFromJoin}
      WHERE 1=1
        ${estoqueFilialFilter}
        ${useProdutosPermitidos ? produtoFilterPermitidos : produtoFilterEstoque}
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        ${company === 'nerd' ? `AND ISNULL(p.GRUPO_PRODUTO, '') <> ''` : `AND ISNULL(p.LINHA, '') <> ''`}
        ${excludeNerdDetalhe}
        ${variacoesGiroFilter}
      GROUP BY 
        e.PRODUTO,
        p.DESC_PRODUTO,
        ${company === 'nerd' ? 'p.GRUPO_PRODUTO,' : 'p.LINHA,'}
        p.SUBGRUPO_PRODUTO,
        p.GRADE,
        p.COLECAO,
        COALESCE(c.DESC_COR, e.COR_PRODUTO),
        p.CUSTO_REPOSICAO1,
        p.PRECO_REPOSICAO_1,
        p.PRECO_A_VISTA_REPOSICAO_1,
        p.REVENDA
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
      preco: number | null;
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
        ${nerdOnlyEletronicosFilter}
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

    let variacoes: ProdutoVariacaoDetalhes[] = variacoesResult.recordset.map((row) => {
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
        preco: Number(row.preco ?? 0),
        custoUnitario: Number(row.custoUnitario ?? 0),
        custoTotal: Number(row.custoTotal ?? 0),
        vendasTotais: vendas,
      };
    });

    // Giro ativo e NÃO é detalhe por categoria: filtrar em JS (só itens que venderam). Quando é detalhe por categoria, a query já aplicou o EXISTS.
    if ((filtrarApenasComVendas || (startDateParam != null && endDateParam != null)) && !detalheCategoriaComGiro) {
      const produtosComVenda = new Set<string>();
      vendasResult.recordset.forEach((row) => {
        const p = row.produto?.trim();
        if (p) produtosComVenda.add(p);
      });
      variacoes = variacoes.filter((v) => produtosComVenda.has(v.produto));
    }

    // Resumo: sempre soma das variações (quando detalhe categoria+giro, a query já é a mesma do card, então o total bate).
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
  preco: number;
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
  produtosPermitidos: produtosPermitidosParam,
}: ProdutoDetalhesParams): Promise<ProdutoDetalhesCompletoPorFilial> {
  return withRequest(async (request) => {
    const useProdutosPermitidos = Array.isArray(produtosPermitidosParam) && produtosPermitidosParam.length > 0;
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

    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    // produtosPermitidos no formato "produto|cor" (giro por cor)
    let produtoFilterPermitidosPorFilial = '';
    if (useProdutosPermitidos && produtosPermitidosParam) {
      const pares = produtosPermitidosParam.slice(0, 2000).map((s) => {
        const t = String(s).trim();
        const i = t.indexOf('|');
        return i >= 0 ? [t.slice(0, i), t.slice(i + 1)] as [string, string] : [t, ''] as [string, string];
      });
      const orClauses = pares.map(([prod, corVal], i) => {
        request.input(`permFilialP${i}`, sql.VarChar, prod);
        request.input(`permFilialC${i}`, sql.VarChar, corVal);
        return `(LTRIM(RTRIM(e.PRODUTO)) = @permFilialP${i} AND ISNULL(LTRIM(RTRIM(e.COR_PRODUTO)), '') = @permFilialC${i})`;
      });
      if (orClauses.length > 0) {
        produtoFilterPermitidosPorFilial = ` AND (${orClauses.join(' OR ')})`;
      }
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
        ISNULL(COALESCE(p.PRECO_REPOSICAO_1, p.PRECO_A_VISTA_REPOSICAO_1, p.REVENDA), 0) AS preco,
        ISNULL(p.CUSTO_REPOSICAO1, 0) AS custoUnitario,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custoTotal
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
        ${useProdutosPermitidos ? produtoFilterPermitidosPorFilial : produtoFilter}
        ${corFilter}
        ${nerdOnlyEletronicosFilter}
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
        p.PRECO_REPOSICAO_1,
        p.PRECO_A_VISTA_REPOSICAO_1,
        p.REVENDA,
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
      preco: number | null;
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
        preco: Number(row.preco ?? 0),
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
          preco: primeiraVariacao ? Number(primeiraVariacao.preco ?? 0) : 0,
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

export interface ProjecaoMensal {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  mes: string; // "JAN", "FEV", etc.
  mesNumero: number; // 1-12
  ano: number;
  vendas: number;
  estoque: number;
  duracao: number; // dias
  isMesAtual: boolean;
  isMesPassado: boolean;
  /** Vendas reais no mês (só no mês atual): varejo + e-commerce até hoje */
  vendasReais?: number;
  /** Projeção por canal (ano passado): varejo e e-commerce para tooltip da linha de projeção */
  vendasVarejo?: number;
  vendasEcommerce?: number;
  /** Vendas reais por canal (só no mês atual): para tooltip da linha VENDA (real) */
  vendasVarejoReal?: number;
  vendasEcommerceReal?: number;
  /** Preenchido só em meses passados: estoque/duração do snapshot daquele mês (aparece ao virar o mês) */
  estoqueRealSnapshot?: number;
  duracaoRealSnapshot?: number;
}

export interface ProjecaoCategoria {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  produto?: string;
  descricao?: string;
  cor?: string;
  meses: ProjecaoMensal[];
}

/**
 * Busca dados de projeção mensal de vendas e estoque
 * Base de projeção: vendas do ano passado + 10%
 */
export async function fetchProjecaoMensal({
  company,
  filial,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<ProjecaoCategoria[]> {
  return withRequest(async (request) => {
    const now = new Date();
    const anoAtual = now.getFullYear();
    const mesAtual = now.getMonth() + 1; // 1-12
    const anoPassado = anoAtual - 1;

    // Sargable year ranges: register early so all queries can use them
    const anoPassadoStart = new Date(anoPassado, 0, 1);
    const anoPassadoEnd = new Date(anoAtual, 0, 1);
    const anoAtualStart = new Date(anoAtual, 0, 1);
    const anoAtualEnd = new Date(anoAtual + 1, 0, 1);
    request.input('anoPassadoStart', sql.DateTime, anoPassadoStart);
    request.input('anoPassadoEnd', sql.DateTime, anoPassadoEnd);
    request.input('anoAtualStart', sql.DateTime, anoAtualStart);
    request.input('anoAtualEnd', sql.DateTime, anoAtualEnd);

    // Determinar campo de categoria baseado na empresa
    const categoriaField = company === 'nerd' 
      ? 'UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, \'\'))))'
      : 'UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, \'\'))))';

    // Campos adicionais para detalhamento
    const camposAdicionais = company === 'scarfme'
      ? ', UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, \'\')))) AS linha, UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, \'\')))) AS subgrupo, UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), \'\')))) AS grade, UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, \'\')))) AS colecao, ISNULL(p.PRODUTO, \'\') AS produto, UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, \'\')))) AS descricao'
      : ', UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, \'\')))) AS subgrupo, UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), \'\')))) AS grade, UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, \'\')))) AS colecao, ISNULL(p.PRODUTO, \'\') AS produto, UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, \'\')))) AS descricao';

    const groupByAdicional = company === 'scarfme'
      ? ', UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, \'\')))), UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, \'\')))), UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), \'\')))), UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, \'\')))), ISNULL(p.PRODUTO, \'\'), UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, \'\'))))'
      : ', UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, \'\')))), UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), \'\')))), UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, \'\')))), ISNULL(p.PRODUTO, \'\'), UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, \'\'))))';

    // Cor do produto: ScarfMe não tem tabela CORES; NERD usa JOIN em CORES para DESC_COR
    // RTRIM/LTRIM em todas as colunas de cor para evitar mismatch por espaços (colunas CHAR)
    const useCoresTable = company !== 'scarfme';
    const corCampoEstoque = useCoresTable
      ? `, UPPER(LTRIM(RTRIM(ISNULL(e.COR_PRODUTO, '')))) AS cor, ISNULL(c.DESC_COR, '') AS corDesc`
      : `, UPPER(LTRIM(RTRIM(ISNULL(e.COR_PRODUTO, '')))) AS cor, '' AS corDesc`;
    const corGroupEstoque = useCoresTable
      ? `, UPPER(LTRIM(RTRIM(ISNULL(e.COR_PRODUTO, '')))), ISNULL(c.DESC_COR, '')`
      : `, UPPER(LTRIM(RTRIM(ISNULL(e.COR_PRODUTO, ''))))`;
    const corCampoVendas = `, UPPER(LTRIM(RTRIM(ISNULL(vp.COR_PRODUTO, '')))) AS cor`;
    const corGroupVendas = `, UPPER(LTRIM(RTRIM(ISNULL(vp.COR_PRODUTO, ''))))`;
    const corCampoEcommerce = `, UPPER(LTRIM(RTRIM(ISNULL(fp.COR_PRODUTO, '')))) AS cor`;
    const corGroupEcommerce = `, UPPER(LTRIM(RTRIM(ISNULL(fp.COR_PRODUTO, ''))))`;

    // Canal: se filial varejo específica (ou VAREJO) → sem e-commerce; se filial e-commerce → sem varejo
    const isEcommerceSelected = isEcommerceFilial(company, filial ?? '');
    const includeEcommerce = company === 'scarfme' && (filial === null || isEcommerceSelected);
    const includeVarejo = !isEcommerceSelected;

    // Quando filial de e-commerce selecionada, estoque deve incluir TODAS as filiais de e-commerce
    // (não apenas a filial "representante" que o buildFilialFilter filtraria para uma só)
    let estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    if (isEcommerceSelected && company === 'scarfme') {
      const companyConfig = resolveCompany(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((f, i) => request.input(`estoqueEcommerceFilial${i}`, sql.VarChar, f.trim()));
        const placeholders = ecommerceFilials.map((_, i) => `@estoqueEcommerceFilial${i}`).join(', ');
        estoqueFilialFilter = `AND e.FILIAL IN (${placeholders})`;
      }
    }

    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineProjecao');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    // Vendas do mês atual (vendasReais): filtrar pela mesma filial/grupo selecionado.
    // Quando filial = null e scarfme, inclui ecommerce de varejo junto (para bater com o card total).
    let vendasMesAtualFilialFilter = '';
    if (company) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        let filiaisParaMesAtual: string[];
        if (filial && filial !== VAREJO_VALUE && !isEcommerceSelected) {
          // Filial específica: usar o grupo dela (ex: ambas as Paulistas)
          filiaisParaMesAtual = getFilialGroupMembers(companyConfig, filial);
        } else if (filial === VAREJO_VALUE) {
          // Varejo: apenas filiais normais (sem e-commerce)
          filiaisParaMesAtual = (companyConfig.filialFilters['sales'] ?? []).filter(
            f => !(companyConfig.ecommerceFilials ?? []).includes(f)
          );
        } else {
          // Todas as filiais (filial = null): inclui varejo + e-commerce para bater com o card total
          filiaisParaMesAtual = Array.from(new Set([
            ...(companyConfig.filialFilters['sales'] ?? []),
            ...(companyConfig.ecommerceFilials ?? []),
          ]));
        }
        if (filiaisParaMesAtual.length > 0) {
          filiaisParaMesAtual.forEach((f, i) => request.input(`vendasMesAtualFilial${i}`, sql.VarChar, f));
          const placeholders = filiaisParaMesAtual.map((_, i) => `@vendasMesAtualFilial${i}`).join(', ');
          vendasMesAtualFilialFilter = `AND vp.FILIAL IN (${placeholders})`;
        }
      }
    }

    // 1. Buscar estoque atual por categoria (ScarfMe não tem tabela CORES)
    const coresJoinEstoque = useCoresTable ? `LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO` : '';
    const estoqueQuery = `
      SELECT
        ${categoriaField} AS categoria
        ${camposAdicionais}${corCampoEstoque},
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoqueAtual
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      ${coresJoinEstoque}
      WHERE 1=1
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND e.ESTOQUE > 0
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByAdicional}${corGroupEstoque}
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    `;

    const estoqueResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      produto?: string;
      descricao?: string;
      cor?: string;
      corDesc?: string;
      estoqueAtual: number | null;
    }>(estoqueQuery);

    // 2. Buscar vendas do ano passado por categoria e mês (varejo)
    const vendasAnoPassadoQuery = `
      SELECT
        ${categoriaField} AS categoria
        ${camposAdicionais}${corCampoVendas},
        MONTH(vp.DATA_VENDA) AS mes,
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @anoPassadoStart AND vp.DATA_VENDA < @anoPassadoEnd
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByAdicional}${corGroupVendas}, MONTH(vp.DATA_VENDA)
    `;

    const vendasAnoPassadoResult = includeVarejo
      ? await request.query<{
          categoria: string;
          linha?: string;
          subgrupo?: string;
          grade?: string;
          colecao?: string;
          mes: number;
          vendas: number | null;
        }>(vendasAnoPassadoQuery)
      : { recordset: [] as Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; mes: number; vendas: number | null }> };

    // 2.1. Buscar vendas de e-commerce do ano passado por categoria e mês (apenas ScarfMe)
    let ecommerceAnoPassadoResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; mes: number; vendas: number | null }> } = { recordset: [] };
    if (includeEcommerce) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
        let ecommerceAnoPassadoFilialFilter = '';
        
        if (ecommerceFilials.length > 0) {
          ecommerceFilials.forEach((f, index) => {
            request.input(`ecommerceAnoPassadoFilial${index}`, sql.VarChar, f.trim());
          });
          const placeholders = ecommerceFilials.map((_, i) => `@ecommerceAnoPassadoFilial${i}`).join(', ');
          ecommerceAnoPassadoFilialFilter = `AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (${placeholders})`;
        }

        if (ecommerceAnoPassadoFilialFilter) {
          // Usar data de entrega (fp.ENTREGA) quando existir, senao emissao - para bater com vendas por mes de entrega
          const dataEcommerce = `COALESCE(CAST(fp.ENTREGA AS DATE), CAST(f.EMISSAO AS DATE))`;
          const ecommerceAnoPassadoQuery = `
            SELECT
              ${categoriaField} AS categoria
              ${camposAdicionais}${corCampoEcommerce},
              MONTH(${dataEcommerce}) AS mes,
              SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
              ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            WHERE f.EMISSAO >= @anoPassadoStart AND f.EMISSAO < @anoPassadoEnd
              AND YEAR(${dataEcommerce}) = ${anoPassado}
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND CAST(fp.QTDE AS FLOAT) > 0
              ${ecommerceAnoPassadoFilialFilter}
              ${grupoFilter}
              ${exclusionFilter}
              ${nerdOnlyEletronicosFilter}
              AND ${categoriaField} <> ''
              AND ${categoriaField} <> 'SEM GRUPO'
              AND ${categoriaField} <> 'SEM LINHA'
              ${buildCategoriaExcludeNerd(company, categoriaField)}
            GROUP BY ${categoriaField}${groupByAdicional}${corGroupEcommerce}, MONTH(${dataEcommerce})
          `;

          ecommerceAnoPassadoResult = await request.query<{
            categoria: string;
            linha?: string;
            subgrupo?: string;
            grade?: string;
            colecao?: string;
            mes: number;
            vendas: number | null;
          }>(ecommerceAnoPassadoQuery);
        }
      }
    }

    // 3. Buscar vendas do mês atual (até hoje) - varejo
    // Usar EXATAMENTE o mesmo período do Controle de Estoque (getCurrentMonthRange + normalizeRangeForQuery)
    // e mesmo operador (end exclusivo: < periodoEnd) para o total bater com "Venda Total (período)"
    const hoje = new Date();
    const currentMonthRange = getCurrentMonthRange();
    const { start: periodoStartMesAtual, end: periodoEndMesAtual } = normalizeRangeForQuery(currentMonthRange);
    const previousMonth = shiftRangeByMonths(currentMonthRange, -1);
    const { start: prevMonthStart, end: prevMonthEnd } = normalizeRangeForQuery(previousMonth);
    const ultimos30DiasStart = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const diasCorridos = hoje.getDate();

    request.input('periodoStartMesAtual', sql.DateTime, periodoStartMesAtual);
    request.input('periodoEndMesAtual', sql.DateTime, periodoEndMesAtual);
    request.input('prevMonthStart', sql.DateTime, prevMonthStart);
    request.input('prevMonthEnd', sql.DateTime, prevMonthEnd);
    request.input('ultimos30Start', sql.DateTime, ultimos30DiasStart);
    request.input('ultimos30End', sql.DateTime, periodoEndMesAtual);

    // Mesma regra do Controle de Estoque: não aplicar linha/subgrupo/grade/coleção nas vendas,
    // só grupo e exclusion, para o total bater com "Venda Total (período)"
    const vendasMesAtualQuery = `
      SELECT
        ${categoriaField} AS categoria
        ${camposAdicionais}${corCampoVendas},
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @periodoStartMesAtual
        AND vp.DATA_VENDA < @periodoEndMesAtual
        AND vp.QTDE > 0
        ${vendasMesAtualFilialFilter}
        ${grupoFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByAdicional}${corGroupVendas}
    `;

    const vendasMesAtualResult = includeVarejo
      ? await request.query<{
          categoria: string;
          linha?: string;
          subgrupo?: string;
          grade?: string;
          colecao?: string;
          vendas: number | null;
        }>(vendasMesAtualQuery)
      : { recordset: [] as Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; vendas: number | null }> };

    // 3.0. Vendas mês anterior e últimos 30 dias (para regra dos primeiros 5 dias = Controle de Estoque)
    const vendasMesAnterior30DiasQuery = `
      SELECT
        ${categoriaField} AS categoria
        ${camposAdicionais}${corCampoVendas},
        SUM(CASE WHEN vp.DATA_VENDA >= @prevMonthStart AND vp.DATA_VENDA < @prevMonthEnd THEN vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0) ELSE 0 END) AS vendasMesAnterior,
        SUM(CASE WHEN vp.DATA_VENDA >= @ultimos30Start AND vp.DATA_VENDA < @ultimos30End THEN vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0) ELSE 0 END) AS vendas30Dias
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @prevMonthStart
        AND vp.DATA_VENDA < @ultimos30End
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByAdicional}${corGroupVendas}
    `;
    const vendasMesAnterior30DiasResult = includeVarejo
      ? await request.query<{
          categoria: string;
          linha?: string;
          subgrupo?: string;
          grade?: string;
          colecao?: string;
          vendasMesAnterior: number | null;
          vendas30Dias: number | null;
        }>(vendasMesAnterior30DiasQuery)
      : { recordset: [] as Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; vendasMesAnterior: number | null; vendas30Dias: number | null }> };

    // 2.9. E-commerce mês anterior e últimos 30 dias (ScarfMe) - para regra dos primeiros 5 dias incluir canal
    let ecommerceMesAnterior30DiasResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; vendasMesAnterior: number | null; vendas30Dias: number | null }> } = { recordset: [] };
    if (includeEcommerce) {
      const companyConfig = resolveCompany(company);
      if (companyConfig?.ecommerceFilials?.length) {
        const ecommerceFilials = companyConfig.ecommerceFilials;
        ecommerceFilials.forEach((f, idx) => request.input(`ecommercePrev30Filial${idx}`, sql.VarChar, f.trim()));
        const placeholders = ecommerceFilials.map((_, i) => `@ecommercePrev30Filial${i}`).join(', ');
        const ecommercePrev30FilialFilter = `AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (${placeholders})`;
        const ecommercePrev30Query = `
          SELECT
            ${categoriaField} AS categoria
            ${camposAdicionais}${corCampoEcommerce},
            SUM(CASE WHEN f.EMISSAO >= @prevMonthStart AND f.EMISSAO < @prevMonthEnd AND f.NOTA_CANCELADA = 0 THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendasMesAnterior,
            SUM(CASE WHEN f.EMISSAO >= @ultimos30Start AND f.EMISSAO < @ultimos30End AND f.NOTA_CANCELADA = 0 THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendas30Dias
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
          WHERE f.EMISSAO >= @prevMonthStart AND f.EMISSAO < @ultimos30End
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            ${ecommercePrev30FilialFilter}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${exclusionFilter}
            ${nerdOnlyEletronicosFilter}
            AND ${categoriaField} <> '' AND ${categoriaField} <> 'SEM GRUPO' AND ${categoriaField} <> 'SEM LINHA'
            ${buildCategoriaExcludeNerd(company, categoriaField)}
          GROUP BY ${categoriaField}${groupByAdicional}${corGroupEcommerce}
        `;
        ecommerceMesAnterior30DiasResult = await request.query(ecommercePrev30Query);
      }
    }

    // 3.1. Buscar vendas de e-commerce do mês atual (até hoje) - apenas ScarfMe
    let ecommerceMesAtualResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; vendas: number | null }> } = { recordset: [] };
    if (includeEcommerce) {
      const companyConfig = resolveCompany(company);
      if (companyConfig) {
        const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
        let ecommerceMesAtualFilialFilter = '';
        
        if (ecommerceFilials.length > 0) {
          ecommerceFilials.forEach((f, index) => {
            request.input(`ecommerceMesAtualFilial${index}`, sql.VarChar, f.trim());
          });
          const placeholders = ecommerceFilials.map((_, i) => `@ecommerceMesAtualFilial${i}`).join(', ');
          ecommerceMesAtualFilialFilter = `AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (${placeholders})`;
        }

        if (ecommerceMesAtualFilialFilter) {
          const ecommerceMesAtualQuery = `
            SELECT
              ${categoriaField} AS categoria
              ${camposAdicionais}${corCampoEcommerce},
              SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
              ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            WHERE f.EMISSAO >= @periodoStartMesAtual
              AND f.EMISSAO < @periodoEndMesAtual
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND CAST(fp.QTDE AS FLOAT) > 0
              ${ecommerceMesAtualFilialFilter}
              ${grupoFilter}
              ${exclusionFilter}
              ${nerdOnlyEletronicosFilter}
              AND ${categoriaField} <> ''
              AND ${categoriaField} <> 'SEM GRUPO'
              AND ${categoriaField} <> 'SEM LINHA'
              ${buildCategoriaExcludeNerd(company, categoriaField)}
            GROUP BY ${categoriaField}${groupByAdicional}${corGroupEcommerce}
          `;

          ecommerceMesAtualResult = await request.query<{
            categoria: string;
            linha?: string;
            subgrupo?: string;
            grade?: string;
            colecao?: string;
            vendas: number | null;
          }>(ecommerceMesAtualQuery);
        }
      }
    }

    // 3.2. Vendas do ano atual por mês (mesma estrutura do ano passado, só ano = atual) — varejo
    const vendasAnoAtualPorMesQuery = `
      SELECT
        ${categoriaField} AS categoria
        ${camposAdicionais}${corCampoVendas},
        MONTH(vp.DATA_VENDA) AS mes,
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @anoAtualStart AND vp.DATA_VENDA < @anoAtualEnd
        AND vp.QTDE > 0
        ${vendasMesAtualFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
      GROUP BY ${categoriaField}${groupByAdicional}${corGroupVendas}, MONTH(vp.DATA_VENDA)
    `;
    const vendasAnoAtualPorMesResult = includeVarejo
      ? await request.query<{
          categoria: string;
          linha?: string;
          subgrupo?: string;
          grade?: string;
          colecao?: string;
          mes: number;
          vendas: number | null;
        }>(vendasAnoAtualPorMesQuery)
      : { recordset: [] as Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; mes: number; vendas: number | null }> };

    // 3.3. E-commerce ano atual por mês (ScarfMe)
    let ecommerceAnoAtualPorMesResult: { recordset: Array<{ categoria: string; linha?: string; subgrupo?: string; grade?: string; colecao?: string; mes: number; vendas: number | null }> } = { recordset: [] };
    if (includeEcommerce) {
      const companyConfig = resolveCompany(company);
      if (companyConfig?.ecommerceFilials?.length) {
        const ecommerceFilials = companyConfig.ecommerceFilials;
        ecommerceFilials.forEach((f, index) => request.input(`ecommerceAnoAtualFilial${index}`, sql.VarChar, f.trim()));
        const placeholders = ecommerceFilials.map((_, i) => `@ecommerceAnoAtualFilial${i}`).join(', ');
        const ecommerceAnoAtualFilialFilter = `AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (${placeholders})`;
        const dataEcommerce = `COALESCE(CAST(fp.ENTREGA AS DATE), CAST(f.EMISSAO AS DATE))`;
        const ecommerceAnoAtualPorMesQuery = `
          SELECT
            ${categoriaField} AS categoria
            ${camposAdicionais}${corCampoEcommerce},
            MONTH(${dataEcommerce}) AS mes,
            SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
          WHERE f.EMISSAO >= @anoAtualStart AND f.EMISSAO < @anoAtualEnd
            AND YEAR(${dataEcommerce}) = ${anoAtual}
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            ${ecommerceAnoAtualFilialFilter}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${exclusionFilter}
            ${nerdOnlyEletronicosFilter}
            AND ${categoriaField} <> '' AND ${categoriaField} <> 'SEM GRUPO' AND ${categoriaField} <> 'SEM LINHA'
            ${buildCategoriaExcludeNerd(company, categoriaField)}
          GROUP BY ${categoriaField}${groupByAdicional}${corGroupEcommerce}, MONTH(${dataEcommerce})
        `;
        ecommerceAnoAtualPorMesResult = await request.query(ecommerceAnoAtualPorMesQuery);
      }
    }

    // 4. Buscar entradas por mês do ano atual (para reconstrução do estoque retroativo dos meses passados)
    // Usa mesma lógica de fetchEstoquePorCategoria: apenas entradas na matriz, excluindo devoluções
    // (saída de loja no mesmo dia que entrada na matriz = devolução, não compra nova).
    const categoriaFieldEntradas = company === 'nerd'
      ? 'ISNULL(pr.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(pr.LINHA, \'SEM LINHA\')';

    const camposEntradasProjecaoAdicionais = company === 'scarfme'
      ? `, UPPER(LTRIM(RTRIM(ISNULL(pr.LINHA, '')))) AS linha, UPPER(LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, '')))) AS subgrupo, UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, pr.GRADE), '')))) AS grade, UPPER(LTRIM(RTRIM(ISNULL(pr.COLECAO, '')))) AS colecao, ISNULL(P.PRODUTO, '') AS produto`
      : `, UPPER(LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, '')))) AS subgrupo, UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, pr.GRADE), '')))) AS grade, UPPER(LTRIM(RTRIM(ISNULL(pr.COLECAO, '')))) AS colecao, ISNULL(P.PRODUTO, '') AS produto`;

    const groupByEntradasProjecaoAdicionais = company === 'scarfme'
      ? `, UPPER(LTRIM(RTRIM(ISNULL(pr.LINHA, '')))), UPPER(LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, '')))), UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, pr.GRADE), '')))), UPPER(LTRIM(RTRIM(ISNULL(pr.COLECAO, '')))), ISNULL(P.PRODUTO, '')`
      : `, UPPER(LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, '')))), UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, pr.GRADE), '')))), UPPER(LTRIM(RTRIM(ISNULL(pr.COLECAO, '')))), ISNULL(P.PRODUTO, '')`;

    // Reutiliza params já registrados, apenas troca prefixo da tabela na string SQL
    const grupoFilterEntradas = grupoFilter ? grupoFilter.replace(/p\./g, 'pr.') : '';
    const linhaFilterEntradas = linhaFilter ? linhaFilter.replace(/p\./g, 'pr.') : '';
    const colecaoFilterEntradas = colecaoFilter ? colecaoFilter.replace(/p\./g, 'pr.') : '';
    const subgrupoFilterEntradas = subgrupoFilter ? subgrupoFilter.replace(/p\./g, 'pr.') : '';
    const gradeFilterEntradas = gradeFilter ? gradeFilter.replace(/p\./g, 'pr.') : '';
    const exclusionFilterEntradas = buildExclusionFilter(request, company, 'pr', 'excludedLineProjecaoEntradas');
    const nerdOnlyEletronicosFilterEntradas = buildNerdOnlyLinhaEletronicosFilter(company, 'pr');

    let matrizProjecaoFilialFilter = '';
    let lojasProjecaoFilterSaidas = '';
    {
      const companyConf = resolveCompany(company);
      if (companyConf) {
        const matrizFiliais: string[] = company === 'scarfme' ? ['SCARF ME - MATRIZ'] : company === 'nerd' ? ['NERD'] : [];
        if (matrizFiliais.length > 0) {
          matrizFiliais.forEach((f, i) => request.input(`matrizProjecaoFilial${i}`, sql.VarChar, f));
          const mPlaceholders = matrizFiliais.map((_, i) => `@matrizProjecaoFilial${i}`).join(', ');
          matrizProjecaoFilialFilter = `AND E.FILIAL IN (${mPlaceholders})`;
        }
        const filiais = companyConf.filialFilters['inventory'] ?? [];
        const ecommerceFilials = companyConf.ecommerceFilials ?? [];
        const lojasNormais = filiais.filter(f =>
          company === 'scarfme' ? f !== 'SCARF ME - MATRIZ' && !ecommerceFilials.includes(f)
          : company === 'nerd' ? f !== 'NERD'
          : true
        );
        if (lojasNormais.length > 0) {
          lojasNormais.forEach((f, i) => request.input(`lojaSaidaProjecao${i}`, sql.VarChar, f));
          const lPlaceholders = lojasNormais.map((_, i) => `@lojaSaidaProjecao${i}`).join(', ');
          lojasProjecaoFilterSaidas = `AND S.FILIAL IN (${lPlaceholders})`;
        }
      }
    }

    const entradasPorMesQuery = `
      SELECT
        ${categoriaFieldEntradas} AS categoria
        ${camposEntradasProjecaoAdicionais},
        UPPER(LTRIM(RTRIM(ISNULL(P.COR_PRODUTO, '')))) AS cor,
        MONTH(E.EMISSAO) AS mes,
        SUM(CAST(P.QTDE AS FLOAT)) AS entradas
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @anoAtualStart AND E.EMISSAO < @periodoEndMesAtual
        ${matrizProjecaoFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        ${nerdOnlyEletronicosFilterEntradas}
        AND ${categoriaFieldEntradas} <> ''
        AND ${categoriaFieldEntradas} <> 'SEM GRUPO'
        AND ${categoriaFieldEntradas} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaFieldEntradas)}
        AND NOT EXISTS (
          SELECT 1
          FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
          WHERE PS.PRODUTO = P.PRODUTO
            AND ISNULL(PS.COR_PRODUTO, '') = ISNULL(P.COR_PRODUTO, '')
            AND CAST(S.EMISSAO AS DATE) = CAST(E.EMISSAO AS DATE)
            ${lojasProjecaoFilterSaidas}
        )
      GROUP BY ${categoriaFieldEntradas}${groupByEntradasProjecaoAdicionais}, UPPER(LTRIM(RTRIM(ISNULL(P.COR_PRODUTO, '')))), MONTH(E.EMISSAO)
    `;

    const entradasPorMesResult = await request.query<{
      categoria: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      produto?: string;
      cor?: string;
      mes: number;
      entradas: number | null;
    }>(entradasPorMesQuery);

    // Processar dados
    const mesesNomes = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    
    // Sempre usar nível máximo de detalhe (categoria + linha + subgrupo + grade + coleção),
    // para permitir expansão no frontend (mesma regra do fetchEstoquePorCategoria).
    // Os filtros (grupos, linhas, subgrupos, grades) continuam aplicados no WHERE das queries.
    const nivelAgrupamento = 2;
    
    // Mapear estoque atual (chave sempre no nível máximo)
    const descricaoMap = new Map<string, string>();
    const corDisplayMap = new Map<string, string>(); // cor display (descrição legível)
    const estoqueMap = new Map<string, number>();
    estoqueResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${row.produto || ''}|${row.cor || ''}`;
      const estoqueAtual = Number(row.estoqueAtual ?? 0);
      estoqueMap.set(key, (estoqueMap.get(key) || 0) + estoqueAtual);
      if (row.descricao && !descricaoMap.has(key)) descricaoMap.set(key, row.descricao);
      if (!corDisplayMap.has(key)) corDisplayMap.set(key, getColorDescription(row.cor, row.corDesc));
    });

    // Mapear vendas do ano passado por mês (varejo) — chave sempre nível máximo
    const vendasAnoPassadoMap = new Map<string, Map<number, number>>();
    const vendasAnoPassadoVarejoMap = new Map<string, Map<number, number>>();
    const vendasAnoPassadoEcommerceMap = new Map<string, Map<number, number>>();
    vendasAnoPassadoResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      if (!vendasAnoPassadoMap.has(key)) {
        vendasAnoPassadoMap.set(key, new Map());
      }
      if (!vendasAnoPassadoVarejoMap.has(key)) {
        vendasAnoPassadoVarejoMap.set(key, new Map());
      }
      const mesMap = vendasAnoPassadoMap.get(key)!;
      const mesMapVarejo = vendasAnoPassadoVarejoMap.get(key)!;
      const mesNumero = row.mes;
      const vendasAtual = Number(row.vendas ?? 0);
      mesMap.set(mesNumero, (mesMap.get(mesNumero) || 0) + vendasAtual);
      mesMapVarejo.set(mesNumero, (mesMapVarejo.get(mesNumero) || 0) + vendasAtual);
    });

    // Somar vendas de e-commerce do ano passado (e no map combinado e no map só e-commerce)
    ecommerceAnoPassadoResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      if (!vendasAnoPassadoMap.has(key)) {
        vendasAnoPassadoMap.set(key, new Map());
      }
      if (!vendasAnoPassadoEcommerceMap.has(key)) {
        vendasAnoPassadoEcommerceMap.set(key, new Map());
      }
      const mesMap = vendasAnoPassadoMap.get(key)!;
      const mesMapEcommerce = vendasAnoPassadoEcommerceMap.get(key)!;
      const mesNumero = row.mes;
      const vendasEcommerce = Number(row.vendas ?? 0);
      mesMap.set(mesNumero, (mesMap.get(mesNumero) || 0) + vendasEcommerce);
      mesMapEcommerce.set(mesNumero, (mesMapEcommerce.get(mesNumero) || 0) + vendasEcommerce);
    });

    // Mapear vendas do mês atual (varejo e e-commerce separados para tooltip na linha "venda real")
    const vendasMesAtualMap = new Map<string, number>();
    const vendasVarejoMesAtualMap = new Map<string, number>();
    const vendasEcommerceMesAtualMap = new Map<string, number>();
    vendasMesAtualResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      const vendasAtual = Number(row.vendas ?? 0);
      vendasMesAtualMap.set(key, (vendasMesAtualMap.get(key) || 0) + vendasAtual);
      vendasVarejoMesAtualMap.set(key, (vendasVarejoMesAtualMap.get(key) || 0) + vendasAtual);
      // Capturar descrição para produtos que podem não ter estoque (segunda passagem)
      if ((row as any).descricao && !descricaoMap.has(key)) descricaoMap.set(key, (row as any).descricao);
    });

    // Somar vendas de e-commerce do mês atual
    ecommerceMesAtualResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      const vendasEcommerce = Number(row.vendas ?? 0);
      vendasMesAtualMap.set(key, (vendasMesAtualMap.get(key) || 0) + vendasEcommerce);
      vendasEcommerceMesAtualMap.set(key, (vendasEcommerceMesAtualMap.get(key) || 0) + vendasEcommerce);
    });

    // Vendas reais por mês (ano atual): total e breakdown varejo/e-commerce para tooltip em todos os meses
    const vendasReaisPorMesMap = new Map<string, Map<number, number>>();
    const vendasReaisVarejoPorMesMap = new Map<string, Map<number, number>>();
    const vendasReaisEcommercePorMesMap = new Map<string, Map<number, number>>();
    vendasAnoAtualPorMesResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      if (!vendasReaisPorMesMap.has(key)) {
        vendasReaisPorMesMap.set(key, new Map());
        vendasReaisVarejoPorMesMap.set(key, new Map());
      }
      const mesMap = vendasReaisPorMesMap.get(key)!;
      const mesMapVarejo = vendasReaisVarejoPorMesMap.get(key)!;
      const mesNumero = row.mes;
      const v = Number(row.vendas ?? 0);
      mesMap.set(mesNumero, (mesMap.get(mesNumero) || 0) + v);
      mesMapVarejo.set(mesNumero, (mesMapVarejo.get(mesNumero) || 0) + v);
      // Capturar descrição para produtos que podem não ter estoque (segunda passagem)
      if ((row as any).descricao && !descricaoMap.has(key)) descricaoMap.set(key, (row as any).descricao);
    });
    ecommerceAnoAtualPorMesResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      if (!vendasReaisPorMesMap.has(key)) {
        vendasReaisPorMesMap.set(key, new Map());
        vendasReaisEcommercePorMesMap.set(key, new Map());
      }
      const mesMap = vendasReaisPorMesMap.get(key)!;
      if (!vendasReaisEcommercePorMesMap.has(key)) vendasReaisEcommercePorMesMap.set(key, new Map());
      const mesMapEcommerce = vendasReaisEcommercePorMesMap.get(key)!;
      const mesNumero = row.mes;
      const v = Number(row.vendas ?? 0);
      mesMap.set(mesNumero, (mesMap.get(mesNumero) || 0) + v);
      mesMapEcommerce.set(mesNumero, (mesMapEcommerce.get(mesNumero) || 0) + v);
    });

    // Mapear vendas mês anterior e últimos 30 dias (regra dos primeiros 5 dias)
    const vendasMesAnteriorMap = new Map<string, number>();
    const vendasUltimos30DiasMap = new Map<string, number>();
    vendasMesAnterior30DiasResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      const vma = Number(row.vendasMesAnterior ?? 0);
      const v30 = Number(row.vendas30Dias ?? 0);
      if (vma > 0) vendasMesAnteriorMap.set(key, vma);
      if (v30 > 0) vendasUltimos30DiasMap.set(key, v30);
    });
    ecommerceMesAnterior30DiasResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${(row as any).produto || ''}|${(row as any).cor || ''}`;
      const vma = Number(row.vendasMesAnterior ?? 0);
      const v30 = Number(row.vendas30Dias ?? 0);
      if (vma > 0) vendasMesAnteriorMap.set(key, (vendasMesAnteriorMap.get(key) || 0) + vma);
      if (v30 > 0) vendasUltimos30DiasMap.set(key, (vendasUltimos30DiasMap.get(key) || 0) + v30);
    });

    // Mapear entradas por mês do ano atual (para reconstrução retroativa do estoque dos meses passados)
    const entradasPorMesMap = new Map<string, Map<number, number>>();
    entradasPorMesResult.recordset.forEach(row => {
      const key = `${row.categoria}|${row.linha || ''}|${row.subgrupo || ''}|${row.grade || ''}|${row.colecao || ''}|${row.produto || ''}|${row.cor || ''}`;
      if (!entradasPorMesMap.has(key)) entradasPorMesMap.set(key, new Map());
      const mesMap = entradasPorMesMap.get(key)!;
      mesMap.set(row.mes, (mesMap.get(row.mes) || 0) + Number(row.entradas ?? 0));
    });

    // Gerar projeções para 12 meses a partir do mês atual
    const categoriasMap = new Map<string, ProjecaoCategoria>();

    estoqueMap.forEach((estoqueInicial, key) => {
      // Chave no formato categoria|linha|subgrupo|grade|colecao|produto|cor
      const parts = key.split('|');
      const categoria = parts[0];
      const linha = parts[1] || undefined;
      const subgrupo = parts[2] || undefined;
      const grade = parts[3] || undefined;
      const colecao = parts[4] || undefined;
      const produto = parts[5] || undefined;
      const cor = corDisplayMap.get(key) || undefined; // descrição legível (ex: "BRANCO", "PRETO")
      const descricao = descricaoMap.get(key) || undefined;

      if (!categoriasMap.has(key)) {
        categoriasMap.set(key, {
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          produto,
          descricao,
          cor,
          meses: [],
        });
      }

      const projecao = categoriasMap.get(key)!;
      let estoqueAtual = estoqueInicial;
      const vendasAnoPassadoPorMes = vendasAnoPassadoMap.get(key) || new Map();
      const vendasAnoPassadoVarejoPorMes = vendasAnoPassadoVarejoMap.get(key) || new Map();
      const vendasAnoPassadoEcommercePorMes = vendasAnoPassadoEcommerceMap.get(key) || new Map();
      const vendasMesAtual = vendasMesAtualMap.get(key) || 0;
      const vendasReaisPorMes = vendasReaisPorMesMap.get(key) || new Map();
      const vendasReaisVarejoPorMes = vendasReaisVarejoPorMesMap.get(key) || new Map();
      const vendasReaisEcommercePorMes = vendasReaisEcommercePorMesMap.get(key) || new Map();

      // Calcular total de vendas do ano passado (para usar como fallback se não houver dados do mês específico)
      let totalVendasAnoPassado = 0;
      vendasAnoPassadoPorMes.forEach(v => totalVendasAnoPassado += v);
      const projecaoMensalMedia = totalVendasAnoPassado > 0 ? (totalVendasAnoPassado / 12) * 1.1 : 0;

      const diasNoMesAtual = new Date(anoAtual, mesAtual, 0).getDate();
      const diasCorridos = now.getDate();

      // Todos os 12 meses do ano (JAN a DEZ) para comparativo anual
      for (let i = 0; i < 12; i++) {
        const mesIndex = i;
        const ano = anoAtual;
        const mesNumero = mesIndex + 1;
        const isMesAtual = mesNumero === mesAtual;
        const isMesPassado = mesNumero < mesAtual;

        let vendas: number;
        let estoqueProjecao: number;
        let vendasReais: number | undefined;
        let vendasVarejoProj: number | undefined;
        let vendasEcommerceProj: number | undefined;

        const varejoMesAnoPassado = vendasAnoPassadoVarejoPorMes.get(mesNumero) || 0;
        const ecommerceMesAnoPassado = vendasAnoPassadoEcommercePorMes.get(mesNumero) || 0;
        const totalLy = varejoMesAnoPassado + ecommerceMesAnoPassado;

        if (isMesPassado) {
          // Mês já passado: tooltip = valores reais ano passado; projeção = soma do tooltip + 10%
          if (totalLy > 0) {
            vendas = Math.round(totalLy * 1.1);
          } else {
            const vendasMesAnoPassado = vendasAnoPassadoPorMes.get(mesNumero) || 0;
            vendas = vendasMesAnoPassado > 0 ? Math.round(vendasMesAnoPassado * 1.1) : Math.round(projecaoMensalMedia);
          }
          estoqueProjecao = 0; // frontend exibe "-"
          const realDoMes = vendasReaisPorMes.get(mesNumero);
          if (realDoMes != null) vendasReais = Math.round(realDoMes);
          vendasVarejoProj = Math.round(varejoMesAnoPassado);
          vendasEcommerceProj = Math.round(ecommerceMesAnoPassado);
        } else if (isMesAtual) {
          // Mesmo critério dos demais meses: tooltip = ano passado; projeção = soma do tooltip + 10%
          if (totalLy > 0) {
            vendas = Math.round(totalLy * 1.1);
          } else {
            const vendasMesAnoPassado = vendasAnoPassadoPorMes.get(mesNumero) || 0;
            vendas = vendasMesAnoPassado > 0 ? Math.round(vendasMesAnoPassado * 1.1) : Math.round(projecaoMensalMedia);
          }
          vendasReais = Math.round(vendasMesAtual);
          vendasVarejoProj = Math.round(varejoMesAnoPassado);
          vendasEcommerceProj = Math.round(ecommerceMesAnoPassado);
          estoqueProjecao = estoqueAtual; // estoque no início do mês (exibido)
        } else {
          // Mês futuro: tooltip = valores reais ano passado; projeção = soma do tooltip + 10%
          if (totalLy > 0) {
            vendas = Math.round(totalLy * 1.1);
          } else {
            const vendasMesAnoPassado = vendasAnoPassadoPorMes.get(mesNumero) || 0;
            vendas = vendasMesAnoPassado > 0 ? Math.round(vendasMesAnoPassado * 1.1) : Math.round(projecaoMensalMedia);
          }
          estoqueProjecao = estoqueAtual;
          vendasVarejoProj = Math.round(varejoMesAnoPassado);
          vendasEcommerceProj = Math.round(ecommerceMesAnoPassado);
        }
        // Atualizar estoque apenas para mês atual e futuros (não para passados)
        if (!isMesPassado) {
          const vendasADescontar = isMesAtual && vendasReais != null
            ? Math.max(0, vendas - vendasReais)
            : vendas;
          estoqueAtual = Math.max(0, estoqueAtual - vendasADescontar);
        }

        const varejoReal = isMesAtual
          ? Math.round(vendasVarejoMesAtualMap.get(key) || 0)
          : Math.round(vendasReaisVarejoPorMes.get(mesNumero) || 0);
        const ecommerceReal = isMesAtual
          ? Math.round(vendasEcommerceMesAtualMap.get(key) || 0)
          : Math.round(vendasReaisEcommercePorMes.get(mesNumero) || 0);
        const temReal = vendasReais != null || varejoReal > 0 || ecommerceReal > 0;
        projecao.meses.push({
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          mes: mesesNomes[mesIndex],
          mesNumero,
          ano,
          vendas,
          estoque: estoqueProjecao,
          duracao: 0, // preenchido abaixo
          isMesAtual,
          isMesPassado,
          ...(vendasReais !== undefined && { vendasReais }),
          ...(vendasVarejoProj !== undefined && { vendasVarejo: vendasVarejoProj }),
          ...(vendasEcommerceProj !== undefined && { vendasEcommerce: vendasEcommerceProj }),
          ...(temReal && { vendasVarejoReal: varejoReal, vendasEcommerceReal: ecommerceReal }),
        });
      }

      // Duração: só para meses com estoque (mês atual e futuros); passados ficam 0
      const diasRestantesMesAtual = diasNoMesAtual - diasCorridos;
      for (let i = 0; i < projecao.meses.length; i++) {
        const mesI = projecao.meses[i];
        if (mesI.estoque <= 0) continue; // mês passado ou sem estoque
        let remaining = mesI.estoque;
        let totalDias = 0;
        let ultimoConsumoDiario = 0;
        const startJ = i;

        for (let j = startJ; j < projecao.meses.length; j++) {
          const mesJ = projecao.meses[j];
          const isMesAtualJ = mesJ.isMesAtual;
          // Mês atual: apenas a diferença (projeção − vendas reais) e apenas dias restantes no mês
          const vendasMes = isMesAtualJ && mesJ.vendasReais != null
            ? Math.max(0, mesJ.vendas - mesJ.vendasReais)
            : mesJ.vendas;
          const diasNoMes = isMesAtualJ && diasRestantesMesAtual > 0
            ? diasRestantesMesAtual
            : new Date(mesJ.ano, mesJ.mesNumero, 0).getDate();
          if (diasNoMes <= 0 || vendasMes <= 0) continue;
          const consumoDiario = vendasMes / diasNoMes;
          ultimoConsumoDiario = consumoDiario;
          const diasParaEsvaziar = remaining / consumoDiario;
          if (diasParaEsvaziar >= diasNoMes) {
            totalDias += diasNoMes;
            remaining -= vendasMes;
          } else {
            totalDias += Math.round(diasParaEsvaziar);
            remaining = 0; // já contabilizado nos dias acima; evita somar de novo no bloco "remaining > 0"
            break;
          }
        }
        // Só estender com consumo do último mês se sobrou estoque após consumir meses INTEIROS (ex.: além de dezembro)
        if (remaining > 0 && ultimoConsumoDiario > 0) {
          totalDias += Math.round(remaining / ultimoConsumoDiario);
        } else if (remaining > 0) {
          // Sem meses seguintes (ex.: duração em dezembro): usar consumo do próprio último mês da janela
          const ultimoMes = projecao.meses[projecao.meses.length - 1];
          const diasNoUltimoMes = new Date(ultimoMes.ano, ultimoMes.mesNumero, 0).getDate();
          if (diasNoUltimoMes > 0 && ultimoMes.vendas > 0) {
            const consumoDiario = ultimoMes.vendas / diasNoUltimoMes;
            totalDias += Math.round(remaining / consumoDiario);
          }
        }
        const estoqueUsado = projecao.meses[i].estoque;
        projecao.meses[i].duracao = estoqueUsado > 0 ? totalDias : 0;
      }

      // Reconstruir estoque retroativo dos meses passados a partir do estoque atual.
      // Fórmula (mesma lógica do controle de estoque):
      //   estoque_inicio_mes(m) = estoque_inicio_mes(m+1) + vendas_reais(m) - entradas(m)
      // Partindo de: estoque_inicio_mesAtual = estoqueAgora + vendasMesAtualAteHoje - entradasMesAtualAteHoje
      if (mesAtual > 1) {
        const entradasPorMes = entradasPorMesMap.get(key) || new Map<number, number>();
        const vendasMesAtualTotal = vendasMesAtualMap.get(key) || 0;
        const entradasMesAtual = entradasPorMes.get(mesAtual) || 0;
        let estoqueReconstruido = Math.max(0, estoqueInicial + vendasMesAtualTotal - entradasMesAtual);
        for (let m = mesAtual - 1; m >= 1; m--) {
          const vendasMes = vendasReaisPorMes.get(m) || 0;
          const entradasMes = entradasPorMes.get(m) || 0;
          estoqueReconstruido = Math.max(0, estoqueReconstruido + vendasMes - entradasMes);
          const mesEntry = projecao.meses[m - 1];
          if (mesEntry && mesEntry.isMesPassado) {
            mesEntry.estoqueRealSnapshot = estoqueReconstruido;
            if (estoqueReconstruido > 0 && vendasMes > 0) {
              const diasNoMes = new Date(anoAtual, m, 0).getDate();
              mesEntry.duracaoRealSnapshot = Math.round(estoqueReconstruido / (vendasMes / diasNoMes));
            } else {
              mesEntry.duracaoRealSnapshot = 0;
            }
          }
        }
      }
    });

    // Segunda passagem: capturar vendas de produtos SEM estoque que venderam no ANO ATUAL.
    // Esses produtos não entram no estoqueMap, logo ficam ausentes do categoriasMap e suas
    // vendasReais seriam perdidas na agregação por linha no frontend.
    // Fonte: apenas vendasMesAtualMap (mês corrente) e vendasReaisPorMesMap (ano atual por mês)
    // → nunca inclui produtos que só venderam no ano passado.
    const todasChavesVendas = new Set([
      ...vendasMesAtualMap.keys(),      // vendas do mês atual (ano corrente)
      ...vendasReaisPorMesMap.keys(),   // vendas mensais do ano corrente
    ]);

    todasChavesVendas.forEach((key) => {
      if (categoriasMap.has(key)) return; // já processado pelo loop do estoque

      const parts = key.split('|');
      const categoria = parts[0];
      if (!categoria || categoria === '' || categoria === 'SEM LINHA' || categoria === 'SEM GRUPO') return;

      const linha = parts[1] || undefined;
      const subgrupo = parts[2] || undefined;
      const grade = parts[3] || undefined;
      const colecao = parts[4] || undefined;
      const produto = parts[5] || undefined;
      // cor: extraída da chave (código bruto, ex: "03").
      // Tenta corDisplayMap primeiro, depois o mapeamento estático colorMapping.json
      // (mesmo caminho dos produtos com estoque via getColorDescription), e por último
      // usa o código bruto como fallback para nunca exibir apenas o número.
      const corRaw = parts[6] || undefined;
      const cor = corRaw
        ? (corDisplayMap.get(key) || getColorDescription(corRaw, '') || corRaw)
        : undefined;

      const vendasMesAtual = vendasMesAtualMap.get(key) || 0;
      const vendasReaisPorMes = vendasReaisPorMesMap.get(key) || new Map();
      const vendasAnoPassadoPorMes = vendasAnoPassadoMap.get(key) || new Map();
      const vendasAnoPassadoVarejoPorMes = vendasAnoPassadoVarejoMap.get(key) || new Map();
      const vendasAnoPassadoEcommercePorMes = vendasAnoPassadoEcommerceMap.get(key) || new Map();

      // Só adicionar se houver vendas reais nesse mês ou no ano atual
      const temVendasReaisAnoAtual = vendasMesAtual > 0 || [...vendasReaisPorMes.values()].some(v => v > 0);
      if (!temVendasReaisAnoAtual) return;

      const projecao: ProjecaoCategoria = {
        categoria,
        linha,
        subgrupo,
        grade,
        colecao,
        produto,
        descricao: descricaoMap.get(key),
        cor,   // preserva cor para que expansão produto+cor funcione no frontend
        meses: [],
      };

      const diasNoMesAtual = new Date(anoAtual, mesAtual, 0).getDate();
      const diasCorridos = now.getDate();

      for (let i = 0; i < 12; i++) {
        const mesNumero = i + 1;
        const isMesAtual = mesNumero === mesAtual;
        const isMesPassado = mesNumero < mesAtual;

        const varejoMesAnoPassado = vendasAnoPassadoVarejoPorMes.get(mesNumero) || 0;
        const ecommerceMesAnoPassado = vendasAnoPassadoEcommercePorMes.get(mesNumero) || 0;
        const totalLy = varejoMesAnoPassado + ecommerceMesAnoPassado;

        let vendas: number;
        if (totalLy > 0) {
          vendas = Math.round(totalLy * 1.1);
        } else {
          const vendasMesAnoPassado = vendasAnoPassadoPorMes.get(mesNumero) || 0;
          vendas = vendasMesAnoPassado > 0 ? Math.round(vendasMesAnoPassado * 1.1) : 0;
        }

        let vendasReais: number | undefined;
        if (isMesAtual) {
          vendasReais = Math.round(vendasMesAtual);
        } else {
          const realDoMes = vendasReaisPorMes.get(mesNumero);
          if (realDoMes != null) vendasReais = Math.round(realDoMes);
        }

        const varejoReal = isMesAtual
          ? Math.round(vendasVarejoMesAtualMap.get(key) || 0)
          : Math.round(vendasReaisVarejoPorMesMap.get(key)?.get(mesNumero) || 0);
        const ecommerceReal = isMesAtual
          ? Math.round(vendasEcommerceMesAtualMap.get(key) || 0)
          : Math.round(vendasReaisEcommercePorMesMap.get(key)?.get(mesNumero) || 0);
        const temReal = vendasReais != null || varejoReal > 0 || ecommerceReal > 0;

        projecao.meses.push({
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          mes: mesesNomes[i],
          mesNumero,
          ano: anoAtual,
          vendas,
          estoque: 0,   // sem estoque — apenas vendasReais importa
          duracao: 0,
          isMesAtual,
          isMesPassado,
          ...(vendasReais !== undefined && { vendasReais }),
          ...(varejoMesAnoPassado > 0 && { vendasVarejo: Math.round(varejoMesAnoPassado) }),
          ...(ecommerceMesAnoPassado > 0 && { vendasEcommerce: Math.round(ecommerceMesAnoPassado) }),
          ...(temReal && { vendasVarejoReal: varejoReal, vendasEcommerceReal: ecommerceReal }),
        });
      }

      categoriasMap.set(key, projecao);
    });

    return Array.from(categoriasMap.values());
  });
}

// ─── Lista de Compra Sugerida ────────────────────────────────────────────────

export interface ProdutoVendaUltimos3Meses {
  produto: string;
  cor?: string;
  corDescricao?: string;
  descricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  vendas3meses: number;
  /** Qtde vendida nos últimos 60 dias (referência visual na lista ABC) */
  vendas60dias: number;
  /** Qtde vendida no mês atual (até agora), usada para duração real */
  vendasMesAtual: number;
  valor3meses: number;
  /** Custo unitário de reposição (PRODUTOS.CUSTO_REPOSICAO1), alinhado ao restante do estoque */
  custoUnitario: number;
  /** Estoque atual (soma de todas as filiais filtradas) */
  estoqueAtual: number;
  percParticipacao: number;
  qtdSugerida: number;
}

export async function fetchTopProdutosUltimos3Meses({
  company,
  filial,
  categoria,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
  produtos,
  qtdCompra,
  porCor = false,
  limit = 50,
}: {
  company?: string;
  filial?: string | null;
  categoria?: string | null;
  grupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  produtos?: string[] | null;
  qtdCompra: number;
  porCor?: boolean;
  limit?: number;
}): Promise<ProdutoVendaUltimos3Meses[]> {
  return withRequest(async (request) => {
    const useCoresTable = company === 'nerd';
    const now = new Date();
    // Últimos 12 meses
    const inicio12Meses = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const inicio60dias = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const inicioMesAtual = new Date(now.getFullYear(), now.getMonth(), 1);
    request.input('inicio3m', sql.DateTime, inicio12Meses);
    request.input('fim3m', sql.DateTime, now);
    request.input('inicio60d', sql.DateTime, inicio60dias);
    request.input('inicioMesAtual', sql.DateTime, inicioMesAtual);
    request.input('lc_limit', sql.Int, limit);

    // Quando se busca por código de produto específico (lookup de preço unitário),
    // os filtros de empresa/exclusão/filial são irrelevantes — o código já identifica o produto.
    // Além disso, inclui todas as filiais (varejo + e-commerce) para preço real.
    const isProdutoLookup = produtos != null && produtos.length > 0;

    const vendasFilialFilter = isProdutoLookup ? '' : buildVendasFilialFilter(request, company, filial, 'vp');
    const estoqueFilialFilter = isProdutoLookup ? '' : buildFilialFilter(request, company, filial, 'e2');
    const grupoFilter = isProdutoLookup ? '' : buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = isProdutoLookup ? '' : buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = isProdutoLookup ? '' : buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = isProdutoLookup ? '' : buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = isProdutoLookup ? '' : buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = isProdutoLookup ? '' : buildExclusionFilter(request, company, 'p', 'excludedLineLc');
    const nerdOnlyEletronicosFilter = isProdutoLookup ? '' : buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    // Filtro de categoria específica (se informado)
    let categoriaFilter = '';
    if (categoria) {
      const categoriaField = company === 'nerd'
        ? 'UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, \'\'))))'
        : 'UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, \'\'))))';
      request.input('lcCategoria', sql.VarChar, categoria.trim().toUpperCase());
      categoriaFilter = `AND ${categoriaField} = @lcCategoria`;
    }

    // Filtro de produtos específicos (para busca de preço unitário)
    let produtosFilter = '';
    if (produtos && produtos.length > 0) {
      const produtosNorm = produtos.map(p => p.trim()).filter(p => p !== '');
      if (produtosNorm.length === 1) {
        request.input('lcProduto0', sql.VarChar, produtosNorm[0]);
        produtosFilter = `AND LTRIM(RTRIM(ISNULL(vp.PRODUTO, ''))) = @lcProduto0`;
      } else if (produtosNorm.length > 1) {
        produtosNorm.forEach((p, i) => request.input(`lcProduto${i}`, sql.VarChar, p));
        const placeholders = produtosNorm.map((_, i) => `@lcProduto${i}`).join(', ');
        produtosFilter = `AND LTRIM(RTRIM(ISNULL(vp.PRODUTO, ''))) IN (${placeholders})`;
      }
    }

    const coresJoin = (porCor && useCoresTable)
      ? `LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR`
      : '';

    const corDescricaoExpr = useCoresTable
      ? `COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, vp.COR_PRODUTO)`
      : `COALESCE(vp.DESC_COR_PRODUTO, vp.COR_PRODUTO)`;

    const query = `
      SELECT TOP (@lc_limit)
        ISNULL(vp.PRODUTO, '') AS produto,
        ${porCor ? "ISNULL(vp.COR_PRODUTO, '') AS cor," : ""}
        ${porCor ? `MAX(ISNULL(${corDescricaoExpr}, '')) AS corDescricao,` : ""}
        UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS descricao,
        MAX(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS linha,
        MAX(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS subgrupo,
        MAX(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS grade,
        MAX(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS qtde3meses,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.DATA_VENDA >= @inicio60d THEN vp.QTDE ELSE 0 END) AS qtde60dias,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.DATA_VENDA >= @inicioMesAtual THEN vp.QTDE ELSE 0 END) AS qtdeMesAtual,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) AS valor3meses,
        MAX(ISNULL(p.CUSTO_REPOSICAO1, 0)) AS custoUnitario,
        MAX(ISNULL(est.estoqueAtual, 0)) AS estoqueAtual
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      ${coresJoin}
      LEFT JOIN (
        SELECT
          e2.PRODUTO,
          ${porCor ? "ISNULL(e2.COR_PRODUTO, '') AS cor," : ""}
          SUM(CASE WHEN e2.ESTOQUE > 0 THEN e2.ESTOQUE ELSE 0 END) AS estoqueAtual
        FROM ESTOQUE_PRODUTOS e2 WITH (NOLOCK)
        WHERE 1=1
          ${estoqueFilialFilter}
        GROUP BY e2.PRODUTO${porCor ? ", ISNULL(e2.COR_PRODUTO, '')" : ""}
      ) est ON est.PRODUTO = ISNULL(vp.PRODUTO, '')${porCor ? " AND ISNULL(est.cor, '') = ISNULL(vp.COR_PRODUTO, '')" : ""}
      WHERE vp.DATA_VENDA >= @inicio3m
        AND vp.DATA_VENDA < @fim3m
        AND vp.QTDE > 0
        ${vendasFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        ${categoriaFilter}
        ${produtosFilter}
      GROUP BY ISNULL(vp.PRODUTO, ''), ${porCor ? "ISNULL(vp.COR_PRODUTO, ''), " : ""}UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))))
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) > 0
      ORDER BY valor3meses DESC
    `;

    const result = await request.query<{
      produto: string;
      cor?: string;
      corDescricao?: string;
      descricao: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      qtde3meses: number;
      qtde60dias: number;
      qtdeMesAtual: number;
      valor3meses: number;
      custoUnitario: number;
      estoqueAtual: number;
    }>(query);

    const rows = result.recordset.map(r => ({
      produto: r.produto?.trim() ?? '',
      ...(porCor ? { cor: (r.cor ?? "").trim() } : {}),
      ...(porCor ? { corDescricao: (r.corDescricao ?? "").trim() || undefined } : {}),
      descricao: r.descricao?.trim() ?? '',
      linha: (r.linha ?? '').trim() || undefined,
      subgrupo: (r.subgrupo ?? '').trim() || undefined,
      grade: (r.grade ?? '').trim() || undefined,
      colecao: (r.colecao ?? '').trim() || undefined,
      vendas3meses: Math.round(Number(r.qtde3meses ?? 0)),
      vendas60dias: Math.round(Number(r.qtde60dias ?? 0)),
      vendasMesAtual: Math.round(Number(r.qtdeMesAtual ?? 0)),
      valor3meses: Math.round(Number(r.valor3meses ?? 0)),
      custoUnitario: Number(r.custoUnitario ?? 0),
      estoqueAtual: Math.round(Number(r.estoqueAtual ?? 0)),
    })).filter(r => r.produto !== '' && r.valor3meses > 0);

    const totalValor = rows.reduce((s, r) => s + r.valor3meses, 0);
    if (totalValor === 0 || qtdCompra <= 0) {
      return rows.map(r => ({ ...r, percParticipacao: 0, qtdSugerida: 0 }));
    }

    // Distribuição proporcional por VALOR de venda — método da maior sobra (Hamilton)
    const withExact = rows.map(r => {
      const perc = r.valor3meses / totalValor;
      const exato = perc * qtdCompra;
      const floor = Math.floor(exato);
      const frac = exato - floor;
      return { ...r, perc, floor, frac };
    });

    const totalFloor = withExact.reduce((s, r) => s + r.floor, 0);
    const remainder = qtdCompra - totalFloor;

    const sortedByFrac = [...withExact]
      .map((r, idx) => ({ idx, frac: r.frac }))
      .sort((a, b) => b.frac - a.frac);

    const boostSet = new Set(sortedByFrac.slice(0, remainder).map(r => r.idx));

    const comSugestao = withExact
      .map((r, i) => ({
        produto: r.produto,
        ...(porCor ? { cor: (r.cor ?? "").trim() } : {}),
        ...(porCor ? { corDescricao: (r.corDescricao ?? "").trim() || undefined } : {}),
        descricao: r.descricao,
        linha: (r.linha ?? '').trim() || undefined,
        subgrupo: (r.subgrupo ?? '').trim() || undefined,
        grade: (r.grade ?? '').trim() || undefined,
        colecao: (r.colecao ?? '').trim() || undefined,
        vendas3meses: r.vendas3meses,
        vendas60dias: r.vendas60dias,
        vendasMesAtual: r.vendasMesAtual,
        valor3meses: r.valor3meses,
        custoUnitario: r.custoUnitario,
        estoqueAtual: r.estoqueAtual,
        percParticipacao: Math.round(r.perc * 1000) / 10,
        qtdSugerida: r.floor + (boostSet.has(i) ? 1 : 0),
      }));

    return comSugestao;
  });
}

export async function fetchEstoqueProdutoPorFilial({
  company,
  filial,
  produto,
  corProduto,
}: {
  company?: string;
  filial?: string | null;
  produto: string;
  corProduto?: string | null;
}): Promise<Array<{ filial: string; estoque: number }>> {
  return withRequest(async (request) => {
    const produtoNorm = produto.trim();
    request.input('p_produto', sql.VarChar, produtoNorm);
    const corNorm = (corProduto ?? '').trim();
    request.input('p_cor', sql.VarChar, corNorm);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial ?? null, 'e');
    const corFilter = corProduto != null ? `AND ISNULL(e.COR_PRODUTO, '') = @p_cor` : '';

    const query = `
      SELECT
        e.FILIAL AS filial,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @p_produto
        ${corFilter}
        ${estoqueFilialFilter}
      GROUP BY e.FILIAL
      ORDER BY e.FILIAL
    `;

    const result = await request.query<{
      filial: string;
      positiveStock: number | null;
      negativeStock: number | null;
      positiveCount: number | null;
    }>(query);

    return result.recordset.map((r) => {
      const positiveStock = Number(r.positiveStock ?? 0);
      const negativeStock = Number(r.negativeStock ?? 0);
      const positiveCount = Number(r.positiveCount ?? 0);
      const estoque = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);
      return { filial: r.filial, estoque: Math.round(estoque) };
    });
  });
}

/**
 * Busca produtos PARADOS por categoria: com estoque positivo nas filiais
 * que NÃO venderam no período selecionado.
 */
export async function fetchParadosPorCategoriaGiro({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleEstoqueParams): Promise<Array<{
  categoria: string;
  estoque: number;
  qtdProdutos: number;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
}>> {
  return withRequest(async (request) => {
    const { start: periodoStart, end: periodoEnd } = resolveRange(range);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp2');
    const grupoFilter = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilter = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilter = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilter = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilter = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilter = buildExclusionFilter(request, company, 'p', 'excludedLineGiro');
    const nerdOnlyEletronicosFilter = buildNerdOnlyLinhaEletronicosFilter(company, 'p');

    const categoriaField = company === 'nerd'
      ? 'ISNULL(p.GRUPO_PRODUTO, \'SEM GRUPO\')'
      : 'ISNULL(p.LINHA, \'SEM LINHA\')';

    request.input('paradosStart', sql.DateTime, periodoStart);
    request.input('paradosEnd', sql.DateTime, periodoEnd);

    // Mesma lógica de expansão/detalhes que fetchVendasPorCategoriaGiro
    const apenasExpansaoSubgrupo = company === 'scarfme' &&
      (linhas && linhas.length > 0) &&
      !(colecoes && colecoes.length > 0) &&
      !(subgrupos && subgrupos.length > 0) &&
      !(grades && grades.length > 0);

    const mostrarDetalhes = (company === 'scarfme' && (
      (linhas && linhas.length > 0) ||
      (colecoes && colecoes.length > 0) ||
      (subgrupos && subgrupos.length > 0) ||
      (grades && grades.length > 0)
    )) || (company === 'nerd' && (
      (subgrupos && subgrupos.length > 0) ||
      (grades && grades.length > 0) ||
      (colecoes && colecoes.length > 0)
    ));

    const camposAdicionais = mostrarDetalhes
      ? (apenasExpansaoSubgrupo
          ? `, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo`
          : (company === 'scarfme'
              ? `, ISNULL(p.LINHA, '') AS linha, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`
              : `, ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo, ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade, ISNULL(p.COLECAO, '') AS colecao`))
      : '';

    const groupByAdicional = mostrarDetalhes
      ? (apenasExpansaoSubgrupo
          ? `, ISNULL(p.SUBGRUPO_PRODUTO, '')`
          : (company === 'scarfme'
              ? `, ISNULL(p.LINHA, ''), ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`
              : `, ISNULL(p.SUBGRUPO_PRODUTO, ''), ISNULL(CONVERT(VARCHAR, p.GRADE), ''), ISNULL(p.COLECAO, '')`))
      : '';

    const query = `
      SELECT
        ${categoriaField} AS categoria${camposAdicionais},
        SUM(e.ESTOQUE) AS estoque,
        COUNT(DISTINCT e.PRODUTO) AS qtdProdutos
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      WHERE e.ESTOQUE > 0
        ${estoqueFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${exclusionFilter}
        ${nerdOnlyEletronicosFilter}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
        ${buildCategoriaExcludeNerd(company, categoriaField)}
        AND NOT EXISTS (
          SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp2 WITH (NOLOCK)
          WHERE vp2.DATA_VENDA >= @paradosStart
            AND vp2.DATA_VENDA < @paradosEnd
            AND vp2.QTDE > 0
            AND vp2.PRODUTO = e.PRODUTO
            ${vendasFilialFilter}
        )
      GROUP BY ${categoriaField}${groupByAdicional}
    `;

    const result = await request.query<{
      categoria: string;
      estoque: number | null;
      qtdProdutos: number | null;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
    }>(query);

    return result.recordset.map(row => ({
      categoria: row.categoria?.trim() || '',
      estoque: Math.round(Number(row.estoque ?? 0)),
      qtdProdutos: Math.round(Number(row.qtdProdutos ?? 0)),
      linha: row.linha?.trim() || undefined,
      subgrupo: row.subgrupo?.trim() || undefined,
      grade: row.grade?.trim() || undefined,
      colecao: row.colecao?.trim() || undefined,
    })).filter(item => item.estoque > 0 && item.categoria !== '')
      .sort((a, b) => b.estoque - a.estoque);
  });
}