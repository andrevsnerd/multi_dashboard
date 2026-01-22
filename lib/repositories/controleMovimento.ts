import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import type { DateRangeInput } from '@/types/dashboard';

function resolveRange(range?: DateRangeInput) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

function buildFilialFilterEntradas(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  specificFilial?: string | null,
  prefix: string = 'E'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);
  if (!company) {
    return '';
  }

  const filiais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Para entradas, geralmente consideramos apenas a matriz (onde as compras chegam)
  // Mas vamos permitir filtrar por filial se necessário
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('entradasFilial', sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @entradasFilial`;
  }

  if (companySlug === 'scarfme' && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    if (normalFiliais.length === 0) {
      return '';
    }
    normalFiliais.forEach((filial, index) => {
      request.input(`entradasFilial${index}`, sql.VarChar, filial);
    });
    const placeholders = normalFiliais.map((_, i) => `@entradasFilial${i}`).join(', ');
    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  // Por padrão, considerar todas as filiais de inventário
  if (filiais.length === 0) {
    return '';
  }

  filiais.forEach((filial, index) => {
    request.input(`entradasFilial${index}`, sql.VarChar, filial);
  });
  const placeholders = filiais.map((_, i) => `@entradasFilial${i}`).join(', ');
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
    const placeholders = normalFiliais.map((_, i) => `@vendasFilial${i}`).join(', ');
    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  if (isScarfme && specificFilial === null) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    if (normalFiliais.length === 0) {
      return '';
    }
    normalFiliais.forEach((filial, index) => {
      request.input(`vendasFilial${index}`, sql.VarChar, filial);
    });
    const placeholders = normalFiliais.map((_, i) => `@vendasFilial${i}`).join(', ');
    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`vendasFilial${index}`, sql.VarChar, filial);
  });
  const placeholders = normalFiliais.map((_, i) => `@vendasFilial${i}`).join(', ');
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
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.GRUPO_PRODUTO, '')))) = @grupo`;
  }

  gruposNormalizados.forEach((grupo, index) => {
    request.input(`grupo${index}`, sql.VarChar, grupo);
  });
  const placeholders = gruposNormalizados.map((_, i) => `@grupo${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.GRUPO_PRODUTO, '')))) IN (${placeholders})`;
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

  linhasNormalizadas.forEach((linha, index) => {
    request.input(`linha${index}`, sql.VarChar, linha);
  });
  const placeholders = linhasNormalizadas.map((_, i) => `@linha${i}`).join(', ');
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

  colecoesNormalizadas.forEach((colecao, index) => {
    request.input(`colecao${index}`, sql.VarChar, colecao);
  });
  const placeholders = colecoesNormalizadas.map((_, i) => `@colecao${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.COLECAO, '')))) IN (${placeholders})`;
}

function buildSubgrupoFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  subgrupos: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (!subgrupos || subgrupos.length === 0) {
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

  subgruposNormalizados.forEach((subgrupo, index) => {
    request.input(`subgrupo${index}`, sql.VarChar, subgrupo);
  });
  const placeholders = subgruposNormalizados.map((_, i) => `@subgrupo${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})`;
}

function buildGradeFilter(
  request: sql.Request | RequestLike,
  company: string | undefined,
  grades: string[] | null | undefined,
  prefix: string = 'p'
): string {
  if (!grades || grades.length === 0) {
    return '';
  }

  const gradesNormalizadas = grades.map(g => String(g).trim()).filter(g => g !== '');
  if (gradesNormalizadas.length === 0) {
    return '';
  }

  if (gradesNormalizadas.length === 1) {
    request.input('grade', sql.VarChar, gradesNormalizadas[0]);
    return `AND CONVERT(VARCHAR, ISNULL(${prefix}.GRADE, '')) = @grade`;
  }

  gradesNormalizadas.forEach((grade, index) => {
    request.input(`grade${index}`, sql.VarChar, grade);
  });
  const placeholders = gradesNormalizadas.map((_, i) => `@grade${i}`).join(', ');
  return `AND CONVERT(VARCHAR, ISNULL(${prefix}.GRADE, '')) IN (${placeholders})`;
}

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
  const excludedLines = companyConfig?.excludedLines ?? [];

  if (excludedLines.length === 0) {
    return '';
  }

  excludedLines.forEach((line, index) => {
    request.input(`${paramPrefix}${index}`, sql.VarChar, line.toUpperCase());
  });

  const placeholders = excludedLines.map((_, i) => `@${paramPrefix}${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${prefix}.LINHA, '')))) NOT IN (${placeholders})`;
}

export interface ControleMovimentoKPIs {
  entradasPeriodo: {
    quantidade: number;
    custo: number;
    quantidadeAnterior: number;
    custoAnterior: number;
  };
  vendidos: {
    quantidade: number;
    valor: number;
    quantidadeAnterior: number;
    valorAnterior: number;
  };
  itensParados: {
    quantidade: number;
    custo: number;
  };
}

export interface ControleMovimentoParams {
  company: string;
  filial?: string | null;
  range?: DateRangeInput;
  grupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
}

export async function fetchControleMovimentoKPIs({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: ControleMovimentoParams): Promise<ControleMovimentoKPIs> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    const previousRange = shiftRangeByMonths({ start, end }, -1);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const companyConfig = resolveCompany(company);
    const categoriaField = company === 'nerd' ? 'pr.GRUPO_PRODUTO' : 'pr.LINHA';

    // Filtros para entradas - APENAS NA MATRIZ (igual ao controle de estoque)
    let matrizFilialFilter = '';
    let lojasFilterSaidas = '';
    
    if (companyConfig) {
      let matrizFiliais: string[] = [];
      if (company === 'scarfme') {
        matrizFiliais = ['SCARF ME - MATRIZ'];
      } else if (company === 'nerd') {
        matrizFiliais = ['NERD'];
      }

      if (matrizFiliais.length > 0) {
        matrizFiliais.forEach((filialMatriz, index) => {
          request.input(`matrizFilial${index}`, sql.VarChar, filialMatriz);
        });
        const placeholders = matrizFiliais.map((_, i) => `@matrizFilial${i}`).join(', ');
        matrizFilialFilter = `AND E.FILIAL IN (${placeholders})`;
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
          request.input(`lojaSaida${index}`, sql.VarChar, filialLoja);
        });
        const placeholders = lojasNormais.map((_, i) => `@lojaSaida${i}`).join(', ');
        lojasFilterSaidas = `AND S.FILIAL IN (${placeholders})`;
      }
    }

    // Filtros de produto para entradas
    const grupoFilterEntradas = buildGrupoFilter(request, company, grupos, 'pr');
    const linhaFilterEntradas = buildLinhaFilter(request, company, linhas, 'pr');
    const colecaoFilterEntradas = buildColecaoFilter(request, company, colecoes, 'pr');
    const subgrupoFilterEntradas = buildSubgrupoFilter(request, company, subgrupos, 'pr');
    const gradeFilterEntradas = buildGradeFilter(request, company, grades, 'pr');
    const exclusionFilterEntradas = buildExclusionFilter(request, company, 'pr', 'excludedLineEntradas');

    // Filtros para vendas
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilterVendas = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilterVendas = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilterVendas = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilterVendas = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilterVendas = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilterVendas = buildExclusionFilter(request, company, 'p', 'excludedLineVendas');

    // 1. Buscar entradas do período atual (apenas na matriz, sem descontar devoluções)
    const entradasQuery = `
      SELECT 
        ISNULL(SUM(CAST(P.QTDE AS FLOAT)), 0) AS quantidade,
        ISNULL(SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)), 0) AS custo
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @startDate
        AND E.EMISSAO < @endDate
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
    `;

    // 2. Buscar entradas do período anterior (apenas na matriz, sem descontar devoluções)
    const entradasAnteriorQuery = `
      SELECT 
        ISNULL(SUM(CAST(P.QTDE AS FLOAT)), 0) AS quantidade,
        ISNULL(SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)), 0) AS custo
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @previousStartDate
        AND E.EMISSAO < @previousEndDate
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
    `;

    // 3. Buscar produtos que entraram no período (para relacionar com vendas)
    // Apenas produtos que entraram na matriz
    const produtosEntradosQuery = `
      SELECT DISTINCT
        P.PRODUTO,
        ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @startDate
        AND E.EMISSAO < @endDate
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
    `;

    // Debug: Log da query para identificar problema de sintaxe
    console.log('[fetchControleMovimentoKPIs] DEBUG - produtosEntradosQuery (primeiros 800 chars):', produtosEntradosQuery.substring(0, 800));
    console.log('[fetchControleMovimentoKPIs] DEBUG - produtosEntradosQuery (últimos 200 chars):', produtosEntradosQuery.substring(produtosEntradosQuery.length - 200));

    // 4. Buscar vendas do período atual (apenas dos produtos que entraram)
    const vendasQuery = `
      WITH ProdutosEntrados AS (
        ${produtosEntradosQuery}
      ),
      VendasBase AS (
        SELECT 
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.PRODUTO,
          ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
          vp.QTDE,
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${vendasFilialFilter}
          ${grupoFilterVendas}
          ${linhaFilterVendas}
          ${colecaoFilterVendas}
          ${subgrupoFilterVendas}
          ${gradeFilterVendas}
          ${exclusionFilterVendas}
      ),
      TrocasItem AS (
        SELECT 
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        WHERE vt.QTDE_CANCELADA = 0
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO
      ),
      VendasComTrocas AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA
        FROM VendasBase vb
        LEFT JOIN TrocasItem ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ti.COR_PRODUTO = vb.COR_PRODUTO
      )
      SELECT 
        SUM(CASE WHEN vct.QTDE_CANCELADA > 0 THEN 0 ELSE vct.QTDE - ISNULL(vct.QTDE_TROCA, 0) END) AS quantidade,
        SUM(CASE 
          WHEN vct.QTDE_CANCELADA > 0 THEN 0 
          ELSE (vct.PRECO_LIQUIDO * vct.QTDE) - ISNULL(vct.DESCONTO_VENDA, 0) - ISNULL(vct.VALOR_TROCA, 0)
        END) AS valor
      FROM VendasComTrocas vct
      INNER JOIN ProdutosEntrados pe ON pe.PRODUTO = vct.PRODUTO 
        AND pe.COR_PRODUTO = vct.COR_PRODUTO
    `;

    // 5. Buscar vendas do período anterior (apenas dos produtos que entraram no período anterior)
    const produtosEntradosAnteriorQuery = `
      SELECT DISTINCT
        P.PRODUTO,
        ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @previousStartDate
        AND E.EMISSAO < @previousEndDate
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
    `;
    const vendasAnteriorQuery = `
      WITH ProdutosEntrados AS (
        ${produtosEntradosAnteriorQuery}
      ),
      VendasBase AS (
        SELECT 
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.PRODUTO,
          ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
          vp.QTDE,
          vp.QTDE_CANCELADA,
          vp.PRECO_LIQUIDO,
          vp.DESCONTO_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.DATA_VENDA >= @previousStartDate
          AND vp.DATA_VENDA < @previousEndDate
          AND vp.QTDE > 0
          ${vendasFilialFilter}
          ${grupoFilterVendas}
          ${linhaFilterVendas}
          ${colecaoFilterVendas}
          ${subgrupoFilterVendas}
          ${gradeFilterVendas}
          ${exclusionFilterVendas}
      ),
      TrocasItem AS (
        SELECT 
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        WHERE vt.QTDE_CANCELADA = 0
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO
      ),
      VendasComTrocas AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA
        FROM VendasBase vb
        LEFT JOIN TrocasItem ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ti.COR_PRODUTO = vb.COR_PRODUTO
      )
      SELECT 
        SUM(CASE WHEN vct.QTDE_CANCELADA > 0 THEN 0 ELSE vct.QTDE - ISNULL(vct.QTDE_TROCA, 0) END) AS quantidade,
        SUM(CASE 
          WHEN vct.QTDE_CANCELADA > 0 THEN 0 
          ELSE (vct.PRECO_LIQUIDO * vct.QTDE) - ISNULL(vct.DESCONTO_VENDA, 0) - ISNULL(vct.VALOR_TROCA, 0)
        END) AS valor
      FROM VendasComTrocas vct
      INNER JOIN ProdutosEntrados pe ON pe.PRODUTO = vct.PRODUTO 
        AND pe.COR_PRODUTO = vct.COR_PRODUTO
    `;

    // Executar todas as queries
    const [
      entradasResult,
      entradasAnteriorResult,
      vendasResult,
      vendasAnteriorResult,
    ] = await Promise.all([
      request.query<{ quantidade: number | null; custo: number | null }>(entradasQuery),
      request.query<{ quantidade: number | null; custo: number | null }>(entradasAnteriorQuery),
      request.query<{ quantidade: number | null; valor: number | null }>(vendasQuery),
      request.query<{ quantidade: number | null; valor: number | null }>(vendasAnteriorQuery),
    ]);

    const entradasQuantidade = Number(entradasResult.recordset[0]?.quantidade ?? 0);
    const entradasCusto = Number(entradasResult.recordset[0]?.custo ?? 0);
    const entradasQuantidadeAnterior = Number(entradasAnteriorResult.recordset[0]?.quantidade ?? 0);
    const entradasCustoAnterior = Number(entradasAnteriorResult.recordset[0]?.custo ?? 0);

    const vendidosQuantidade = Number(vendasResult.recordset[0]?.quantidade ?? 0);
    const vendidosValor = Number(vendasResult.recordset[0]?.valor ?? 0);
    const vendidosQuantidadeAnterior = Number(vendasAnteriorResult.recordset[0]?.quantidade ?? 0);
    const vendidosValorAnterior = Number(vendasAnteriorResult.recordset[0]?.valor ?? 0);

    // 6. Calcular itens parados produto por produto (igual ao modal)
    // Buscar entradas agrupadas por produto+cor
    const entradasDetalhadasQuery = `
      SELECT 
        P.PRODUTO,
        ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO,
        SUM(CAST(P.QTDE AS FLOAT)) AS QTDE_ENTRADA,
        SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)) AS CUSTO_ENTRADA
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
      WHERE pr.PRODUTO IS NOT NULL
        AND E.EMISSAO >= @startDate
        AND E.EMISSAO < @endDate
        ${matrizFilialFilter}
        ${grupoFilterEntradas}
        ${linhaFilterEntradas}
        ${colecaoFilterEntradas}
        ${subgrupoFilterEntradas}
        ${gradeFilterEntradas}
        ${exclusionFilterEntradas}
        AND ${categoriaField} <> ''
        AND ${categoriaField} <> 'SEM GRUPO'
        AND ${categoriaField} <> 'SEM LINHA'
      GROUP BY P.PRODUTO, P.COR_PRODUTO
    `;

    // Buscar vendas agrupadas por produto+cor
    const vendasDetalhadasQuery = `
      WITH ProdutosEntrados AS (
        ${produtosEntradosQuery}
      ),
      VendasBase AS (
        SELECT 
          vp.PRODUTO,
          ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
          vp.QTDE,
          vp.QTDE_CANCELADA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${vendasFilialFilter}
          ${grupoFilterVendas}
          ${linhaFilterVendas}
          ${colecaoFilterVendas}
          ${subgrupoFilterVendas}
          ${gradeFilterVendas}
          ${exclusionFilterVendas}
      ),
      TrocasItem AS (
        SELECT 
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          SUM(vt.QTDE) AS QTDE_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        WHERE vt.QTDE_CANCELADA = 0
          AND CAST(vt.DATA_VENDA AS DATE) >= CAST(@startDate AS DATE)
          AND CAST(vt.DATA_VENDA AS DATE) < CAST(@endDate AS DATE)
        GROUP BY vt.PRODUTO, vt.COR_PRODUTO
      ),
      VendasComTrocas AS (
        SELECT 
          vb.PRODUTO,
          vb.COR_PRODUTO,
          SUM(CASE WHEN vb.QTDE_CANCELADA > 0 THEN 0 ELSE vb.QTDE - ISNULL(ti.QTDE_TROCA, 0) END) AS QTDE_VENDIDA
        FROM VendasBase vb
        LEFT JOIN TrocasItem ti ON ti.PRODUTO = vb.PRODUTO AND ti.COR_PRODUTO = vb.COR_PRODUTO
        INNER JOIN ProdutosEntrados pe ON pe.PRODUTO = vb.PRODUTO AND pe.COR_PRODUTO = vb.COR_PRODUTO
        GROUP BY vb.PRODUTO, vb.COR_PRODUTO
      )
      SELECT 
        PRODUTO,
        COR_PRODUTO,
        QTDE_VENDIDA
      FROM VendasComTrocas
    `;

    const [entradasDetalhadasResult, vendasDetalhadasResult] = await Promise.all([
      request.query<{
        PRODUTO: string;
        COR_PRODUTO: string;
        QTDE_ENTRADA: number;
        CUSTO_ENTRADA: number;
      }>(entradasDetalhadasQuery),
      request.query<{
        PRODUTO: string;
        COR_PRODUTO: string;
        QTDE_VENDIDA: number;
      }>(vendasDetalhadasQuery),
    ]);

    // Criar map de vendas
    const vendasMap = new Map<string, number>();
    vendasDetalhadasResult.recordset.forEach((v) => {
      const key = `${v.PRODUTO}|${v.COR_PRODUTO}`;
      vendasMap.set(key, v.QTDE_VENDIDA);
    });

    // Calcular itens parados produto por produto
    // Parados = produtos que entraram mas não venderam (ou venderam menos do que entraram)
    // Vendidos mantém o valor total (pode incluir vendas de estoque anterior)
    let itensParadosQuantidade = 0;
    let itensParadosCusto = 0;
    
    entradasDetalhadasResult.recordset.forEach((e) => {
      const key = `${e.PRODUTO}|${e.COR_PRODUTO}`;
      const vendida = vendasMap.get(key) || 0;
      
      // Parados = entrada - venda (só conta se > 0)
      // Se vendeu mais do que entrou, não há parados (pode ter vendido estoque anterior)
      const parada = e.QTDE_ENTRADA - vendida;
      
      if (parada > 0) {
        const custoMedio = e.QTDE_ENTRADA > 0 ? e.CUSTO_ENTRADA / e.QTDE_ENTRADA : 0;
        itensParadosQuantidade += parada;
        itensParadosCusto += parada * custoMedio;
      }
    });
    
    // Vendidos mantém o valor total (todas as vendas dos produtos que entraram)
    const vendidosQuantidadeFinal = vendidosQuantidade;
    const vendidosValorFinal = vendidosValor;

    return {
      entradasPeriodo: {
        quantidade: entradasQuantidade,
        custo: entradasCusto,
        quantidadeAnterior: entradasQuantidadeAnterior,
        custoAnterior: entradasCustoAnterior,
      },
      vendidos: {
        quantidade: vendidosQuantidade,
        valor: vendidosValor,
        quantidadeAnterior: vendidosQuantidadeAnterior,
        valorAnterior: vendidosValorAnterior,
      },
      itensParados: {
        quantidade: itensParadosQuantidade,
        custo: itensParadosCusto,
      },
    };
  });
}

export interface MovimentoDetalhesParams {
  company: string;
  tipo: 'entradas' | 'vendidos' | 'parados';
  range?: DateRangeInput;
  filial?: string | null;
  grupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
}

export interface ProdutoMovimentoDetalhe {
  produto: string;
  corProduto: string;
  descProduto: string;
  quantidade: number;
  custo?: number;
  valor?: number;
  linha?: string;
  grupo?: string;
  colecao?: string;
  subgrupo?: string;
  grade?: string;
}

export async function fetchMovimentoDetalhes({
  company,
  tipo,
  range,
  filial,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: MovimentoDetalhesParams): Promise<ProdutoMovimentoDetalhe[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    const previousRange = shiftRangeByMonths({ start, end }, -1);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const companyConfig = resolveCompany(company);
    const categoriaField = company === 'nerd' ? 'pr.GRUPO_PRODUTO' : 'pr.LINHA';

    // Filtros para entradas - APENAS NA MATRIZ
    let matrizFilialFilter = '';
    let lojasFilterSaidas = '';
    
    if (companyConfig) {
      let matrizFiliais: string[] = [];
      if (company === 'scarfme') {
        matrizFiliais = ['SCARF ME - MATRIZ'];
      } else if (company === 'nerd') {
        matrizFiliais = ['NERD'];
      }

      if (matrizFiliais.length > 0) {
        matrizFiliais.forEach((filialMatriz, index) => {
          request.input(`matrizFilial${index}`, sql.VarChar, filialMatriz);
        });
        const placeholders = matrizFiliais.map((_, i) => `@matrizFilial${i}`).join(', ');
        matrizFilialFilter = `AND E.FILIAL IN (${placeholders})`;
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
          request.input(`lojaSaida${index}`, sql.VarChar, filialLoja);
        });
        const placeholders = lojasNormais.map((_, i) => `@lojaSaida${i}`).join(', ');
        lojasFilterSaidas = `AND S.FILIAL IN (${placeholders})`;
      }
    }

    // Filtros de produto para entradas
    const grupoFilterEntradas = buildGrupoFilter(request, company, grupos, 'pr');
    const linhaFilterEntradas = buildLinhaFilter(request, company, linhas, 'pr');
    const colecaoFilterEntradas = buildColecaoFilter(request, company, colecoes, 'pr');
    const subgrupoFilterEntradas = buildSubgrupoFilter(request, company, subgrupos, 'pr');
    const gradeFilterEntradas = buildGradeFilter(request, company, grades, 'pr');
    const exclusionFilterEntradas = buildExclusionFilter(request, company, 'pr', 'excludedLineEntradas');

    // Filtros para vendas
    const vendasFilialFilter = buildVendasFilialFilter(request, company, filial, 'vp');
    const grupoFilterVendas = buildGrupoFilter(request, company, grupos, 'p');
    const linhaFilterVendas = buildLinhaFilter(request, company, linhas, 'p');
    const colecaoFilterVendas = buildColecaoFilter(request, company, colecoes, 'p');
    const subgrupoFilterVendas = buildSubgrupoFilter(request, company, subgrupos, 'p');
    const gradeFilterVendas = buildGradeFilter(request, company, grades, 'p');
    const exclusionFilterVendas = buildExclusionFilter(request, company, 'p', 'excludedLineVendas');

    if (tipo === 'entradas') {
      // Buscar produtos que entraram no período (todas as entradas, sem descontar devoluções)
      const query = `
        SELECT 
          P.PRODUTO AS produto,
          ISNULL(P.COR_PRODUTO, '') AS corProduto,
          pr.DESC_PRODUTO AS descProduto,
          SUM(CAST(P.QTDE AS FLOAT)) AS quantidade,
          SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)) AS custo,
          pr.LINHA AS linha,
          pr.GRUPO_PRODUTO AS grupo,
          pr.COLECAO AS colecao,
          pr.SUBGRUPO_PRODUTO AS subgrupo,
          pr.GRADE AS grade
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
          AND E.EMISSAO >= @startDate
          AND E.EMISSAO < @endDate
          ${matrizFilialFilter}
          ${grupoFilterEntradas}
          ${linhaFilterEntradas}
          ${colecaoFilterEntradas}
          ${subgrupoFilterEntradas}
          ${gradeFilterEntradas}
          ${exclusionFilterEntradas}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
        GROUP BY P.PRODUTO, P.COR_PRODUTO, pr.DESC_PRODUTO, pr.LINHA, pr.GRUPO_PRODUTO, pr.COLECAO, pr.SUBGRUPO_PRODUTO, pr.GRADE
        ORDER BY quantidade DESC
      `;

      const result = await request.query<ProdutoMovimentoDetalhe>(query);
      return result.recordset;
    } else if (tipo === 'vendidos') {
      // Buscar produtos vendidos (que entraram no período)
      const produtosEntradosQuery = `
        SELECT DISTINCT
          P.PRODUTO,
          ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
          AND E.EMISSAO >= @startDate
          AND E.EMISSAO < @endDate
          ${matrizFilialFilter}
          ${grupoFilterEntradas}
          ${linhaFilterEntradas}
          ${colecaoFilterEntradas}
          ${subgrupoFilterEntradas}
          ${gradeFilterEntradas}
          ${exclusionFilterEntradas}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
      `;

      const query = `
        WITH ProdutosEntrados AS (
          ${produtosEntradosQuery}
        ),
        VendasBase AS (
          SELECT 
            vp.PRODUTO,
            ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
            vp.QTDE,
            vp.QTDE_CANCELADA,
            vp.PRECO_LIQUIDO,
            vp.DESCONTO_VENDA
          FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE > 0
            ${vendasFilialFilter}
            ${grupoFilterVendas}
            ${linhaFilterVendas}
            ${colecaoFilterVendas}
            ${subgrupoFilterVendas}
            ${gradeFilterVendas}
            ${exclusionFilterVendas}
        ),
        TrocasItem AS (
          SELECT 
            vt.PRODUTO,
            ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
            SUM(vt.QTDE) AS QTDE_TROCA,
            SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          WHERE vt.QTDE_CANCELADA = 0
            AND CAST(vt.DATA_VENDA AS DATE) >= CAST(@startDate AS DATE)
            AND CAST(vt.DATA_VENDA AS DATE) < CAST(@endDate AS DATE)
          GROUP BY vt.PRODUTO, vt.COR_PRODUTO
        ),
        VendasComTrocas AS (
          SELECT 
            vb.PRODUTO,
            vb.COR_PRODUTO,
            SUM(CASE WHEN vb.QTDE_CANCELADA > 0 THEN 0 ELSE vb.QTDE - ISNULL(ti.QTDE_TROCA, 0) END) AS quantidade,
            SUM(CASE 
              WHEN vb.QTDE_CANCELADA > 0 THEN 0 
              ELSE (vb.PRECO_LIQUIDO * vb.QTDE) - ISNULL(vb.DESCONTO_VENDA, 0) - ISNULL(ti.VALOR_TROCA, 0)
            END) AS valor
          FROM VendasBase vb
          LEFT JOIN TrocasItem ti ON ti.PRODUTO = vb.PRODUTO AND ti.COR_PRODUTO = vb.COR_PRODUTO
          INNER JOIN ProdutosEntrados pe ON pe.PRODUTO = vb.PRODUTO AND pe.COR_PRODUTO = vb.COR_PRODUTO
          GROUP BY vb.PRODUTO, vb.COR_PRODUTO
        )
        SELECT 
          vct.PRODUTO AS produto,
          vct.COR_PRODUTO AS corProduto,
          p.DESC_PRODUTO AS descProduto,
          vct.quantidade AS quantidade,
          vct.valor AS valor,
          p.LINHA AS linha,
          p.GRUPO_PRODUTO AS grupo,
          p.COLECAO AS colecao,
          p.SUBGRUPO_PRODUTO AS subgrupo,
          p.GRADE AS grade
        FROM VendasComTrocas vct
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vct.PRODUTO
        WHERE vct.quantidade > 0
        ORDER BY vct.quantidade DESC
      `;

      const result = await request.query<ProdutoMovimentoDetalhe>(query);
      return result.recordset;
    } else if (tipo === 'parados') {
      // tipo === 'parados': produtos que entraram mas não venderam
      // Primeiro buscar entradas, depois vendas, e calcular diferença
      const entradasQuery = `
        SELECT 
          P.PRODUTO,
          ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO,
          pr.DESC_PRODUTO,
          pr.LINHA,
          pr.GRUPO_PRODUTO,
          pr.COLECAO,
          pr.SUBGRUPO_PRODUTO,
          pr.GRADE,
          SUM(CAST(P.QTDE AS FLOAT)) AS QTDE_ENTRADA,
          SUM(CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0)) AS CUSTO_ENTRADA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
          AND E.EMISSAO >= @startDate
          AND E.EMISSAO < @endDate
          ${matrizFilialFilter}
          ${grupoFilterEntradas}
          ${linhaFilterEntradas}
          ${colecaoFilterEntradas}
          ${subgrupoFilterEntradas}
          ${gradeFilterEntradas}
          ${exclusionFilterEntradas}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
        GROUP BY P.PRODUTO, P.COR_PRODUTO, pr.DESC_PRODUTO, pr.LINHA, pr.GRUPO_PRODUTO, pr.COLECAO, pr.SUBGRUPO_PRODUTO, pr.GRADE
      `;

      const produtosEntradosQuery = `
        SELECT DISTINCT
          P.PRODUTO,
          ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
          AND E.EMISSAO >= @startDate
          AND E.EMISSAO < @endDate
          ${matrizFilialFilter}
          ${grupoFilterEntradas}
          ${linhaFilterEntradas}
          ${colecaoFilterEntradas}
          ${subgrupoFilterEntradas}
          ${gradeFilterEntradas}
          ${exclusionFilterEntradas}
          AND ${categoriaField} <> ''
          AND ${categoriaField} <> 'SEM GRUPO'
          AND ${categoriaField} <> 'SEM LINHA'
      `;

      const vendasQuery = `
        WITH ProdutosEntrados AS (
          ${produtosEntradosQuery}
        ),
        VendasBase AS (
          SELECT 
            vp.PRODUTO,
            ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
            SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS QTDE_VENDIDA
          FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE > 0
            ${vendasFilialFilter}
            ${grupoFilterVendas}
            ${linhaFilterVendas}
            ${colecaoFilterVendas}
            ${subgrupoFilterVendas}
            ${gradeFilterVendas}
            ${exclusionFilterVendas}
          GROUP BY vp.PRODUTO, vp.COR_PRODUTO
        ),
        TrocasItem AS (
          SELECT 
            vt.PRODUTO,
            ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
            SUM(vt.QTDE) AS QTDE_TROCA
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          WHERE vt.QTDE_CANCELADA = 0
            AND CAST(vt.DATA_VENDA AS DATE) >= CAST(@startDate AS DATE)
            AND CAST(vt.DATA_VENDA AS DATE) < CAST(@endDate AS DATE)
          GROUP BY vt.PRODUTO, vt.COR_PRODUTO
        ),
        VendasFinais AS (
          SELECT 
            vb.PRODUTO,
            vb.COR_PRODUTO,
            vb.QTDE_VENDIDA - ISNULL(ti.QTDE_TROCA, 0) AS QTDE_VENDIDA
          FROM VendasBase vb
          LEFT JOIN TrocasItem ti ON ti.PRODUTO = vb.PRODUTO AND ti.COR_PRODUTO = vb.COR_PRODUTO
          INNER JOIN ProdutosEntrados pe ON pe.PRODUTO = vb.PRODUTO AND pe.COR_PRODUTO = vb.COR_PRODUTO
        )
        SELECT * FROM VendasFinais
      `;

      const [entradasResult, vendasResult] = await Promise.all([
        request.query<{
          PRODUTO: string;
          COR_PRODUTO: string;
          DESC_PRODUTO: string;
          LINHA: string;
          GRUPO_PRODUTO: string;
          COLECAO: string;
          SUBGRUPO_PRODUTO: string;
          GRADE: string;
          QTDE_ENTRADA: number;
          CUSTO_ENTRADA: number;
        }>(entradasQuery),
        request.query<{
          PRODUTO: string;
          COR_PRODUTO: string;
          QTDE_VENDIDA: number;
        }>(vendasQuery),
      ]);

      // Criar map de vendas
      const vendasMap = new Map<string, number>();
      vendasResult.recordset.forEach((v) => {
        const key = `${v.PRODUTO}|${v.COR_PRODUTO}`;
        vendasMap.set(key, v.QTDE_VENDIDA);
      });

      // Calcular itens parados
      const parados: ProdutoMovimentoDetalhe[] = [];
      entradasResult.recordset.forEach((e) => {
        const key = `${e.PRODUTO}|${e.COR_PRODUTO}`;
        const vendida = vendasMap.get(key) || 0;
        const parada = e.QTDE_ENTRADA - vendida;
        
        if (parada > 0) {
          const custoMedio = e.QTDE_ENTRADA > 0 ? e.CUSTO_ENTRADA / e.QTDE_ENTRADA : 0;
          parados.push({
            produto: e.PRODUTO,
            corProduto: e.COR_PRODUTO,
            descProduto: e.DESC_PRODUTO || '',
            quantidade: parada,
            custo: parada * custoMedio,
            linha: e.LINHA,
            grupo: e.GRUPO_PRODUTO,
            colecao: e.COLECAO,
            subgrupo: e.SUBGRUPO_PRODUTO,
            grade: e.GRADE,
          });
        }
      });

      return parados.sort((a, b) => b.quantidade - a.quantidade);
    }
    
    
    // Se nenhum tipo corresponder, retornar array vazio
    return [];
  });
}
