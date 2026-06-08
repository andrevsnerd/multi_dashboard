/**
 * Vendedores V2 - Backend otimizado para carregar rápido.
 * - Lista: uma query só em W_CTB_LOJA_VENDA_PEDIDO_PRODUTO (vp), sem join com pedido.
 * - Apelido do vendedor: segunda query rápida em LOJA_VENDEDORES (tabela pequena).
 */

import sql from 'mssql';
import {
  getActiveFilial,
  getFilialGroupMembers,
  getFilialLabelForDisplay,
  type CompanyConfig,
  type CompanyModule,
  VAREJO_VALUE,
} from '@/lib/config/company';
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export interface VendedorItem {
  vendedor: string;
  /** Rótulo da filial (ex.: grupo "MORUMBI 1"); após agregação, é o nome do grupo. */
  filial: string;
  /**
   * Código ERP da filial para drill-down (detalhe do vendedor).
   * Quando há agregação por grupo lógico, aponta para a filial ativa do grupo.
   */
  filialConsulta?: string;
  faturamento: number;
  faturamentoPrevious?: number;
  quantidadeVendida: number;
  /** Desconto total concedido pelo vendedor no período (R$). */
  desconto: number;
  tickets: number;
  ticketMedio: number;
  quantidadePorTicket: number;
  participacaoFilial: number;
  categoriaMaisVendida?: string;
  grupoMaisVendido?: string;
  linhaMaisVendida?: string;
  subgrupoMaisVendido?: string;
}

/**
 * Une linhas do mesmo vendedor quando várias filiais ERP pertencem ao mesmo rótulo
 * (grupos em filialDisplayNames / filialGroups). Soma métricas e recalcula participação
 * na filial lógica; `filial` vira o rótulo e `filialConsulta` a filial ativa para detalhe.
 */
export function aggregateVendedoresByFilialLabel(
  items: VendedorItem[],
  company: CompanyConfig | null
): VendedorItem[] {
  if (!company || items.length === 0) return items;

  type Bucket = {
    vendedor: string;
    label: string;
    consulta: string;
    faturamento: number;
    quantidadeVendida: number;
    desconto: number;
    tickets: number;
    faturamentoPrevious: number;
    hasPrev: boolean;
    bestFat: number;
    categoriaMaisVendida?: string;
    grupoMaisVendido?: string;
    linhaMaisVendida?: string;
    subgrupoMaisVendido?: string;
  };

  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const rawFilial = (item.filial ?? '').trim();
    const label = getFilialLabelForDisplay(company, rawFilial);
    const consulta = (getActiveFilial(company, rawFilial) || rawFilial).trim();
    const key = `${item.vendedor}\u0000${label}`;

    const fat = item.faturamento ?? 0;
    const prev = item.faturamentoPrevious;
    const hasPrev = prev !== undefined && !Number.isNaN(prev);

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        vendedor: item.vendedor,
        label,
        consulta,
        faturamento: fat,
        quantidadeVendida: item.quantidadeVendida ?? 0,
        desconto: item.desconto ?? 0,
        tickets: item.tickets ?? 0,
        faturamentoPrevious: hasPrev ? (prev as number) : 0,
        hasPrev,
        bestFat: fat,
        categoriaMaisVendida: item.categoriaMaisVendida,
        grupoMaisVendido: item.grupoMaisVendido,
        linhaMaisVendida: item.linhaMaisVendida,
        subgrupoMaisVendido: item.subgrupoMaisVendido,
      });
      continue;
    }

    existing.faturamento += fat;
    existing.quantidadeVendida += item.quantidadeVendida ?? 0;
    existing.desconto += item.desconto ?? 0;
    existing.tickets += item.tickets ?? 0;
    if (hasPrev) {
      existing.faturamentoPrevious += prev as number;
      existing.hasPrev = true;
    }
    if (fat > existing.bestFat) {
      existing.bestFat = fat;
      existing.categoriaMaisVendida = item.categoriaMaisVendida;
      existing.grupoMaisVendido = item.grupoMaisVendido;
      existing.linhaMaisVendida = item.linhaMaisVendida;
      existing.subgrupoMaisVendido = item.subgrupoMaisVendido;
    }
  }

  const merged: VendedorItem[] = Array.from(buckets.values()).map((b) => {
    const tickets = b.tickets;
    const ticketMedio = tickets > 0 ? b.faturamento / tickets : 0;
    const quantidadePorTicket =
      tickets > 0 ? b.quantidadeVendida / tickets : 0;

    const row: VendedorItem = {
      vendedor: b.vendedor,
      filial: b.label,
      filialConsulta: b.consulta,
      faturamento: b.faturamento,
      quantidadeVendida: b.quantidadeVendida,
      desconto: b.desconto,
      tickets,
      ticketMedio,
      quantidadePorTicket,
      participacaoFilial: 0,
      categoriaMaisVendida: b.categoriaMaisVendida,
      grupoMaisVendido: b.grupoMaisVendido,
      linhaMaisVendida: b.linhaMaisVendida,
      subgrupoMaisVendido: b.subgrupoMaisVendido,
    };
    if (b.hasPrev) {
      row.faturamentoPrevious = b.faturamentoPrevious;
    }
    return row;
  });

  const totalByLabel = new Map<string, number>();
  for (const m of merged) {
    totalByLabel.set(
      m.filial,
      (totalByLabel.get(m.filial) ?? 0) + m.faturamento
    );
  }
  for (const m of merged) {
    const tot = totalByLabel.get(m.filial) ?? 0;
    m.participacaoFilial = tot > 0 ? (m.faturamento / tot) * 100 : 0;
  }

  merged.sort((a, b) => b.faturamento - a.faturamento);
  return merged;
}

export interface VendedorProdutoItem {
  codigo?: string;
  grupo?: string;
  linha?: string;
  colecao?: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  descricao: string;
  faturamento: number;
  quantidade: number;
  /** Desconto concedido neste produto pelo vendedor no período (R$). */
  desconto: number;
}

export interface VendedoresListParams {
  company?: string;
  filial?: string | null;
  /** Lista expandida de filiais (grupo). Quando fornecida, sobrescreve filial. */
  filials?: string[];
  range?: { start?: Date | string; end?: Date | string };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  produtoId?: string;
  produtoSearchTerm?: string;
  /** false = inclui grupo/subgrupo mais vendido (mais lento). Default true = só métricas. */
  light?: boolean;
  comparisonMode?: 'month' | 'year';
}

async function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp'
): Promise<string> {
  if (!companySlug) return '';
  const company = await resolveCompanyLive(companySlug);
  if (!company) return '';

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  specificFilial = await liveNameForIncoming(specificFilial);

  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const isScarfme = companySlug === 'scarfme';

  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('filial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @filial`;
  }

  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter((f) => !ecommerceFilials.includes(f));
    if (normalFiliais.length === 0) return '';
    normalFiliais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
    return `AND ${tableAlias}.FILIAL IN (${normalFiliais.map((_, i) => `@filial${i}`).join(', ')})`;
  }

  if (isScarfme && specificFilial === null && filiais.length > 0) {
    filiais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
    return `AND ${tableAlias}.FILIAL IN (${filiais.map((_, i) => `@filial${i}`).join(', ')})`;
  }

  if (filiais.length === 0) return '';
  filiais.forEach((f, i) => request.input(`filial${i}`, sql.VarChar, f));
  return `AND ${tableAlias}.FILIAL IN (${filiais.map((_, i) => `@filial${i}`).join(', ')})`;
}

function buildListFilter(
  request: sql.Request | RequestLike,
  fieldExpression: string,
  values: string[] | undefined,
  paramBase: string
): string {
  if (!values?.length) return '';
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (!nonEmpty.length) return '';
  nonEmpty.forEach((v, i) => request.input(`${paramBase}${i}`, sql.VarChar, v));
  return `AND ${fieldExpression} IN (${nonEmpty.map((_, i) => `@${paramBase}${i}`).join(', ')})`;
}

async function buildDetailFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  filial: string,
  fieldExpression: string,
  paramBase: string
): Promise<string> {
  const filialTrimRaw = filial.trim();
  if (!filialTrimRaw) return '';

  const company = await resolveCompanyLive(companySlug);
  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  const filialTrim = (await liveNameForIncoming(filialTrimRaw)) ?? filialTrimRaw;
  const filiais = company
    ? Array.from(
        new Set(
          getFilialGroupMembers(company, filialTrim)
            .map((item) => item.trim())
            .filter(Boolean)
        )
      )
    : [filialTrim];

  filiais.forEach((item, index) => {
    request.input(`${paramBase}${index}`, sql.VarChar, item);
  });

  if (filiais.length === 1) {
    return `AND ${fieldExpression} = @${paramBase}0`;
  }

  return `AND ${fieldExpression} IN (${filiais.map((_, index) => `@${paramBase}${index}`).join(', ')})`;
}

/**
 * Lista de vendedores: uma passagem com CTEs.
 * light=true (default): só métricas, sem grupo/subgrupo mais vendido.
 */
export async function fetchVendedoresList(
  params: VendedoresListParams
): Promise<VendedorItem[]> {
  const mainData = await withRequest(async (request) => {
    const {
      company,
      filial,
      filials,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
      light = true,
    } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Se filials (grupo expandido) foi fornecido, filtra pela lista; senão filtra pela filial individual.
    let filialFilter: string;
    if (filials && filials.length > 0) {
      filials.forEach((f, i) => request.input(`fgrp${i}`, sql.VarChar, f));
      filialFilter = `AND f.FILIAL IN (${filials.map((_, i) => `@fgrp${i}`).join(', ')})`;
    } else {
      filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'f');
    }

    const hasProdutoSearchTerm = (produtoSearchTerm?.trim() ?? '').length >= 2;
    const needProdutoJoin =
      (grupos?.length ?? 0) > 0 ||
      (linhas?.length ?? 0) > 0 ||
      (colecoes?.length ?? 0) > 0 ||
      (subgrupos?.length ?? 0) > 0 ||
      (grades?.length ?? 0) > 0 ||
      hasProdutoSearchTerm;

    const grupoFilter = buildListFilter(
      request,
      "COALESCE(p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );
    const linhaFilter = buildListFilter(
      request,
      "COALESCE(p.LINHA, '')",
      linhas,
      'linha'
    );
    const colecaoFilter = buildListFilter(
      request,
      "COALESCE(p.COLECAO, '')",
      colecoes,
      'colecao'
    );
    const subgrupoFilter = buildListFilter(
      request,
      "COALESCE(p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );
    const gradeFilter = buildListFilter(
      request,
      'CONVERT(VARCHAR, p.GRADE)',
      grades,
      'grade'
    );

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = 'AND vp.PRODUTO = @produtoId';
    } else if (hasProdutoSearchTerm) {
      request.input('produtoSearchTerm', sql.VarChar, `%${(produtoSearchTerm ?? '').trim()}%`);
      produtoFilter = "AND COALESCE(p.DESC_PRODUTO, '') LIKE @produtoSearchTerm";
    }

    const produtoJoin =
      needProdutoJoin
        ? `LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO`
        : '';

    // Mesmo mapeamento do exportar_todos_relatorios.py:
    // VENDEDOR vem de LOJA_VENDA, FILIAL vem de FILIAIS, apelido via LEFT JOIN LOJA_VENDEDORES.
    const mainQuery = `
      WITH Base AS (
        SELECT
          f.FILIAL,
          LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) AS VENDEDOR,
          ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR)))) AS VENDEDOR_APELIDO,
          valor = CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END,
          desconto = CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END,
          qtde_eff = CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END,
          ticket = CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.QTDE > 0 THEN vp.TICKET ELSE NULL END
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
          ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
        ${produtoJoin}
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${needProdutoJoin ? grupoFilter : ''}
          ${needProdutoJoin ? linhaFilter : ''}
          ${needProdutoJoin ? colecaoFilter : ''}
          ${needProdutoJoin ? subgrupoFilter : ''}
          ${needProdutoJoin ? gradeFilter : ''}
          ${produtoFilter}
      ),
      Agg AS (
        SELECT
          FILIAL,
          VENDEDOR,
          MAX(VENDEDOR_APELIDO) AS VENDEDOR_APELIDO,
          SUM(valor) AS faturamento,
          SUM(desconto) AS desconto,
          SUM(qtde_eff) AS quantidadeVendida,
          COUNT(DISTINCT ticket) AS tickets
        FROM Base
        GROUP BY FILIAL, VENDEDOR
        HAVING SUM(valor) > 0
      )
      SELECT
        VENDEDOR AS vendedorCodigo,
        VENDEDOR_APELIDO AS vendedor,
        FILIAL AS filial,
        faturamento,
        desconto,
        quantidadeVendida,
        tickets,
        SUM(faturamento) OVER (PARTITION BY FILIAL) AS totalFilial
      FROM Agg
      ORDER BY faturamento DESC
    `;

    const mainResult = await request.query<{
      vendedorCodigo: string;
      vendedor: string;
      filial: string;
      faturamento: number;
      desconto: number;
      quantidadeVendida: number;
      tickets: number;
      totalFilial: number;
    }>(mainQuery);

    // Keep raw code→filial map for previous period matching
    const rawRows = mainResult.recordset.map(row => ({
      codigo: (row.vendedorCodigo ?? '').trim(),
      filial: row.filial,
    }));

    const items: VendedorItem[] = mainResult.recordset.map((row) => {
      const faturamento = row.faturamento ?? 0;
      const tickets = row.tickets ?? 0;
      const quantidadeVendida = row.quantidadeVendida ?? 0;
      const desconto = row.desconto ?? 0;
      const totalFilial = row.totalFilial ?? 0;
      const ticketMedio = tickets > 0 ? faturamento / tickets : 0;
      const quantidadePorTicket = tickets > 0 ? quantidadeVendida / tickets : 0;
      const participacaoFilial = totalFilial > 0 ? (faturamento / totalFilial) * 100 : 0;
      const nomeExibir = (row.vendedor ?? '').trim() || 'SEM VENDEDOR';

      return {
        vendedor: nomeExibir,
        filial: row.filial,
        faturamento,
        quantidadeVendida,
        desconto,
        tickets,
        ticketMedio,
        quantidadePorTicket,
        participacaoFilial,
      };
    });

    if (!light && company) {
      const categoriaExpr =
        company === 'scarfme'
          ? `UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))`
          : `UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))))`;

      const categoriaResult = await request.query<{
        vendedorCodigo: string;
        filial: string;
        categoria: string;
      }>(`
        WITH BaseCategoria AS (
          SELECT
            f.FILIAL,
            LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) AS vendedorCodigo,
            ${categoriaExpr} AS categoria,
            valor = CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0))
            END
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK)
            ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE > 0
            ${filialFilter}
            ${grupoFilter}
            ${linhaFilter}
            ${colecaoFilter}
            ${subgrupoFilter}
            ${gradeFilter}
            ${produtoFilter}
        ),
        AggCategoria AS (
          SELECT
            FILIAL,
            vendedorCodigo,
            categoria,
            SUM(valor) AS faturamentoCategoria
          FROM BaseCategoria
          WHERE categoria <> ''
          GROUP BY FILIAL, vendedorCodigo, categoria
        ),
        RankedCategoria AS (
          SELECT
            FILIAL,
            vendedorCodigo,
            categoria,
            ROW_NUMBER() OVER (
              PARTITION BY FILIAL, vendedorCodigo
              ORDER BY faturamentoCategoria DESC, categoria ASC
            ) AS rn
          FROM AggCategoria
        )
        SELECT
          vendedorCodigo,
          FILIAL AS filial,
          categoria
        FROM RankedCategoria
        WHERE rn = 1
      `);

      const categoriaMap = new Map<string, string>();
      categoriaResult.recordset.forEach((row) => {
        categoriaMap.set(
          `${(row.vendedorCodigo ?? '').trim()}|${row.filial}`,
          (row.categoria ?? '').trim()
        );
      });

      rawRows.forEach((raw, index) => {
        const categoria = categoriaMap.get(`${raw.codigo}|${raw.filial}`);
        if (!categoria) return;

        items[index].categoriaMaisVendida = categoria;
        if (company === 'scarfme') {
          items[index].subgrupoMaisVendido = categoria;
        } else {
          items[index].grupoMaisVendido = categoria;
        }
      });
    }

    return { items, rawRows };
  });

  const { items, rawRows } = mainData;

  // Fetch previous period faturamento if comparisonMode is given
  if (params.comparisonMode && params.range) {
    try {
      const { start: startRaw } = normalizeRangeForQuery(params.range);
      const prevMonth = params.comparisonMode === 'year'
        ? startRaw.getMonth()
        : (startRaw.getMonth() === 0 ? 11 : startRaw.getMonth() - 1);
      const prevYear = params.comparisonMode === 'year'
        ? startRaw.getFullYear() - 1
        : (startRaw.getMonth() === 0 ? startRaw.getFullYear() - 1 : startRaw.getFullYear());
      const startPrev = new Date(Date.UTC(prevYear, prevMonth, 1));
      const endPrev = new Date(Date.UTC(prevYear, prevMonth + 1, 1));

      const prevMap = await withRequest(async (req) => {
        req.input('startDate', sql.DateTime, startPrev);
        req.input('endDate', sql.DateTime, endPrev);
        let filialFilter: string;
        if (params.filials && params.filials.length > 0) {
          params.filials.forEach((fv, i) => req.input(`pfgrp${i}`, sql.VarChar, fv));
          filialFilter = `AND f.FILIAL IN (${params.filials.map((_, i) => `@pfgrp${i}`).join(', ')})`;
        } else {
          filialFilter = await buildFilialFilter(req, params.company, 'sales', params.filial ?? null, 'f');
        }
        const query = `
          SELECT
            LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) AS vendedor,
            f.FILIAL AS filial,
            SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END) AS faturamento
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vp.CODIGO_FILIAL
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE > 0
            ${filialFilter}
          GROUP BY LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))), f.FILIAL
          HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END) > 0
        `;
        const result = await req.query<{ vendedor: string; filial: string; faturamento: number }>(query);
        const map = new Map<string, number>();
        result.recordset.forEach(r => {
          map.set(`${(r.vendedor ?? '').trim()}|${r.filial}`, r.faturamento ?? 0);
        });
        return map;
      });

      rawRows.forEach((raw, i) => {
        const prev = prevMap.get(`${raw.codigo}|${raw.filial}`);
        if (prev !== undefined) items[i].faturamentoPrevious = prev;
      });
    } catch {
      // non-fatal
    }
  }

  return items;
}

export interface VendedorProdutosListParams {
  company?: string;
  vendedor: string;
  filial: string;
  range?: { start?: Date | string; end?: Date | string };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  produtoId?: string;
  produtoSearchTerm?: string;
}

export interface VendedorProdutoVendaItem {
  data: string; // ISO date string (YYYY-MM-DD)
  cor?: string;
  faturamento: number;
  quantidade: number;
}

export interface VendedorProdutoVendasParams {
  company?: string;
  vendedor: string;
  filial: string;
  produto: string;
  range?: { start?: Date | string; end?: Date | string };
}

/**
 * Vendas por data de um produto específico de um vendedor.
 */
export async function fetchVendedorProdutoVendas(
  params: VendedorProdutoVendasParams
): Promise<VendedorProdutoVendaItem[]> {
  return withRequest(async (request) => {
    const { company, vendedor, filial, produto, range } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('produto', sql.VarChar, produto);
    const filialFilter = await buildDetailFilialFilter(
      request,
      company,
      filial,
      'vp.FILIAL',
      'filialVenda'
    );

    // Resolve vendedor code(s) from LOJA_VENDEDORES (small table, fast)
    request.input('vendedorApelido', sql.VarChar, vendedor);
    const codigoResult = await request.query<{ codigo: string }>(`
      SELECT LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo
      FROM LOJA_VENDEDORES WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, CAST(VENDEDOR AS VARCHAR))))) = @vendedorApelido
    `);
    const codigos = (codigoResult.recordset ?? []).map((r) => r.codigo).filter(Boolean);
    if (codigos.length === 0) codigos.push(vendedor);
    codigos.forEach((c, i) => request.input(`vcode${i}`, sql.VarChar, c));
    const vendedorFilter = `AND vp.VENDEDOR IN (${codigos.map((_, i) => `@vcode${i}`).join(', ')})`;

    const query = `
      SELECT
        CONVERT(VARCHAR(10), vp.DATA_VENDA, 23) AS data,
        MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS cor,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) AS faturamento,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS quantidade
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        AND vp.PRODUTO = @produto
        ${vendedorFilter}
      GROUP BY CONVERT(VARCHAR(10), vp.DATA_VENDA, 23), vp.COR_PRODUTO
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) > 0
      ORDER BY data ASC, cor ASC
    `;

    const result = await request.query<{
      data: string;
      cor: string;
      faturamento: number;
      quantidade: number;
    }>(query);

    return result.recordset.map((row) => ({
      data: row.data,
      cor: row.cor?.trim() || undefined,
      faturamento: row.faturamento ?? 0,
      quantidade: row.quantidade ?? 0,
    }));
  });
}

export interface VendedorClienteItem {
  data: string; // YYYY-MM-DD (CADASTRAMENTO)
  nome: string;
  telefone: string;
  cpf: string;
  endereco: string;
  cidade: string;
}

export interface VendedorClientesListParams {
  company?: string;
  vendedor: string;
  filial: string;
  range?: { start?: Date | string; end?: Date | string };
}

/**
 * Clientes cadastrados pelo vendedor no período: busca direto em CLIENTES_VAREJO via CADASTRAMENTO.
 * Não há FK entre W_CTB_LOJA_VENDA_PEDIDO e CLIENTES_VAREJO, portanto não é possível linkar vendas a clientes.
 */
export async function fetchVendedorClientesList(
  params: VendedorClientesListParams
): Promise<VendedorClienteItem[]> {
  return withRequest(async (request) => {
    const { company, vendedor, filial, range } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const filialFilter = await buildDetailFilialFilter(
      request,
      company,
      filial,
      'LTRIM(RTRIM(cv.FILIAL))',
      'filialCliente'
    );

    // Resolve vendedor code(s) from LOJA_VENDEDORES
    request.input('vendedorApelido', sql.VarChar, vendedor);
    const codigoResult = await request.query<{ codigo: string }>(`
      SELECT LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo
      FROM LOJA_VENDEDORES WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, CAST(VENDEDOR AS VARCHAR))))) = @vendedorApelido
    `);
    const codigos = (codigoResult.recordset ?? []).map((r) => r.codigo).filter(Boolean);
    if (codigos.length === 0) codigos.push(vendedor);
    codigos.forEach((c, i) => request.input(`vcode${i}`, sql.VarChar, c));
    const vendedorFilter = `AND LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) IN (${codigos.map((_, i) => `@vcode${i}`).join(', ')})`;

    const query = `
      SELECT
        CONVERT(VARCHAR(10), cv.CADASTRAMENTO, 23) AS data,
        ISNULL(LTRIM(RTRIM(cv.CLIENTE_VAREJO)), '') AS nome,
        CASE
          WHEN cv.DDD IS NOT NULL AND LTRIM(RTRIM(cv.DDD)) <> '' AND cv.TELEFONE IS NOT NULL
          THEN LTRIM(RTRIM(cv.DDD)) + ' ' + LTRIM(RTRIM(cv.TELEFONE))
          ELSE ISNULL(LTRIM(RTRIM(cv.TELEFONE)), '')
        END AS telefone,
        ISNULL(LTRIM(RTRIM(cv.CPF_CGC)), '') AS cpf,
        ISNULL(LTRIM(RTRIM(cv.ENDERECO)), '') AS endereco,
        ISNULL(LTRIM(RTRIM(cv.CIDADE)), '') AS cidade
      FROM CLIENTES_VAREJO cv WITH (NOLOCK)
      WHERE cv.CADASTRAMENTO >= @startDate
        AND cv.CADASTRAMENTO < @endDate
        ${filialFilter}
        ${vendedorFilter}
      ORDER BY cv.CADASTRAMENTO ASC, cv.CLIENTE_VAREJO ASC
    `;

    const result = await request.query<{
      data: string;
      nome: string;
      telefone: string;
      cpf: string;
      endereco: string;
      cidade: string;
    }>(query);

    return result.recordset.map((row) => ({
      data: row.data,
      nome: row.nome?.trim() || '',
      telefone: row.telefone?.trim() || '',
      cpf: row.cpf?.trim() || '',
      endereco: row.endereco?.trim() || '',
      cidade: row.cidade?.trim() || '',
    }));
  });
}

export interface ClienteProdutoItem {
  codigo?: string;
  grupo?: string;
  linha?: string;
  colecao?: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  descricao: string;
  faturamento: number;
  quantidade: number;
}

export interface ClienteProdutosListParams {
  company?: string;
  clienteNome: string;
  filial: string;
  range?: { start?: Date | string; end?: Date | string };
}

/**
 * Produtos comprados pelo cliente: tenta linkar via CPF (v.CPF_CGC) ou nome (v.NOME_CLIFOR).
 * Usa W_CTB_LOJA_VENDA_PEDIDO como ponte entre vp (itens) e os dados do cliente.
 */
export async function fetchClienteProdutosList(
  params: ClienteProdutosListParams
): Promise<ClienteProdutoItem[]> {
  return withRequest(async (request) => {
    const { company, clienteNome, filial, range } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const filialFilter = await buildDetailFilialFilter(
      request,
      company,
      filial,
      'vp.FILIAL',
      'filialClienteProduto'
    );
    // W_CTB_LOJA_VENDA_PEDIDO.CLIENTE_VAREJO = nome do cliente (confirmado no script Python)
    request.input('clienteNome', sql.VarChar, clienteNome);

    const query = `
      SELECT
        MAX(vp.PRODUTO) AS codigo,
        MAX(ISNULL(vp.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(vp.LINHA, p.LINHA, '')) AS linha,
        MAX(COALESCE(vp.COLECAO, p.COLECAO, '')) AS colecao,
        MAX(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(ISNULL(CONVERT(VARCHAR, p.GRADE), '')) AS grade,
        MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS cor,
        MAX(vp.DESC_PRODUTO) AS descricao,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) AS faturamento,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS quantidade
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      INNER JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL AND v.PEDIDO = vp.PEDIDO AND v.TICKET = vp.TICKET
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        AND v.CLIENTE_VAREJO = @clienteNome
      GROUP BY vp.PRODUTO, vp.DESC_PRODUTO
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) > 0
      ORDER BY faturamento DESC
    `;

    const result = await request.query<{
      codigo: string;
      grupo: string;
      linha: string;
      colecao: string;
      subgrupo: string;
      grade: string;
      cor: string;
      descricao: string;
      faturamento: number;
      quantidade: number;
    }>(query);

    return result.recordset.map((row) => ({
      codigo: row.codigo || undefined,
      grupo: row.grupo?.trim() || undefined,
      linha: row.linha?.trim() || undefined,
      colecao: row.colecao?.trim() || undefined,
      subgrupo: row.subgrupo?.trim() || undefined,
      grade: row.grade?.trim() || undefined,
      cor: row.cor?.trim() || undefined,
      descricao: row.descricao || 'SEM DESCRIÇÃO',
      faturamento: row.faturamento ?? 0,
      quantidade: row.quantidade ?? 0,
    }));
  });
}

/**
 * Produtos do vendedor: query enxuta, só campos usados na tela.
 */
export async function fetchVendedorProdutosList(
  params: VendedorProdutosListParams
): Promise<VendedorProdutoItem[]> {
  return withRequest(async (request) => {
    const {
      company,
      vendedor,
      filial,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
    } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const filialFilter = await buildDetailFilialFilter(
      request,
      company,
      filial,
      'vp.FILIAL',
      'filialProduto'
    );

    // Resolve vendedor code(s) from LOJA_VENDEDORES (small table, fast)
    request.input('vendedorApelido', sql.VarChar, vendedor);
    const codigoResult = await request.query<{ codigo: string }>(`
      SELECT LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo
      FROM LOJA_VENDEDORES WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, CAST(VENDEDOR AS VARCHAR))))) = @vendedorApelido
    `);
    const codigos = (codigoResult.recordset ?? []).map((r) => r.codigo).filter(Boolean);
    // Fallback: try matching by raw code if apelido not found
    if (codigos.length === 0) codigos.push(vendedor);
    codigos.forEach((c, i) => request.input(`vcode${i}`, sql.VarChar, c));
    const vendedorFilter = `AND vp.VENDEDOR IN (${codigos.map((_, i) => `@vcode${i}`).join(', ')})`;

    const grupoFilter = buildListFilter(
      request,
      "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );
    const linhaFilter = buildListFilter(
      request,
      "COALESCE(vp.LINHA, p.LINHA, '')",
      linhas,
      'linha'
    );
    const colecaoFilter = buildListFilter(
      request,
      "COALESCE(vp.COLECAO, p.COLECAO, '')",
      colecoes,
      'colecao'
    );
    const subgrupoFilter = buildListFilter(
      request,
      "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );
    const gradeFilter = buildListFilter(
      request,
      'CONVERT(VARCHAR, p.GRADE)',
      grades,
      'grade'
    );

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = 'AND vp.PRODUTO = @produtoId';
    } else if ((produtoSearchTerm?.trim() ?? '').length >= 2) {
      request.input('produtoSearchTerm', sql.VarChar, `%${(produtoSearchTerm ?? '').trim()}%`);
      produtoFilter = 'AND vp.DESC_PRODUTO LIKE @produtoSearchTerm';
    }

    const query = `
      SELECT
        MAX(vp.PRODUTO) AS codigo,
        MAX(ISNULL(vp.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(vp.LINHA, p.LINHA, '')) AS linha,
        MAX(COALESCE(vp.COLECAO, p.COLECAO, '')) AS colecao,
        MAX(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(ISNULL(CONVERT(VARCHAR, p.GRADE), '')) AS grade,
        MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS cor,
        MAX(vp.DESC_PRODUTO) AS descricao,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) AS faturamento,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS quantidade,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE ISNULL(vp.DESCONTO_VENDA, 0) END) AS desconto
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${vendedorFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
      GROUP BY vp.PRODUTO, vp.DESC_PRODUTO
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) > 0
      ORDER BY faturamento DESC
    `;

    const result = await request.query<{
      codigo: string;
      grupo: string;
      linha: string;
      colecao: string;
      subgrupo: string;
      grade: string;
      cor: string;
      descricao: string;
      faturamento: number;
      quantidade: number;
      desconto: number;
    }>(query);

    return result.recordset.map((row) => ({
      codigo: row.codigo || undefined,
      grupo: row.grupo?.trim() || undefined,
      linha: row.linha?.trim() || undefined,
      colecao: row.colecao?.trim() || undefined,
      subgrupo: row.subgrupo?.trim() || undefined,
      grade: row.grade?.trim() || undefined,
      cor: row.cor?.trim() || undefined,
      descricao: row.descricao || 'SEM DESCRIÇÃO',
      faturamento: row.faturamento ?? 0,
      quantidade: row.quantidade ?? 0,
      desconto: row.desconto ?? 0,
    }));
  });
}

export interface ProdutoDescontoItem {
  produto: string;
  descricao: string;
  cor?: string;
  corCodigo?: string;
  grupo?: string;
  linha?: string;
  subgrupo?: string;
  colecao?: string;
  grade?: string;
  quantidade: number;
  faturamento: number;
  desconto: number;
  /** % do valor bruto que virou desconto: desconto / (faturamento + desconto). */
  descontoPct: number;
}

export interface ProdutosComDescontoParams {
  company?: string;
  /** Filial específica; vazio/omitido = todas. */
  filial?: string;
  /** Apelido/código do vendedor; omitido = todos os vendedores. */
  vendedor?: string;
  range?: { start?: Date | string; end?: Date | string };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
  produtoId?: string;
  produtoSearchTerm?: string;
  /** Quebra por cor (padrão true → uma linha por produto×cor). */
  porCor?: boolean;
  limit?: number;
}

/**
 * Lista os produtos que foram vendidos COM desconto no período, por produto
 * (×cor por padrão), trazendo quanto foi descontado em cada (R$ e %). Consulta
 * W_CTB_LOJA_VENDA_PEDIDO_PRODUTO direto (mesma fonte de DESCONTO_VENDA usada na
 * ficha do produto), então NÃO depende da query da página /produtos. Aceita
 * `vendedor` opcional para relacionar desconto × produto × vendedor. Só retorna
 * itens com desconto > 0, do maior desconto para o menor.
 */
export async function fetchProdutosComDesconto(
  params: ProdutosComDescontoParams
): Promise<ProdutoDescontoItem[]> {
  return withRequest(async (request) => {
    const {
      company,
      filial = '',
      vendedor,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
      porCor = true,
      limit = 100,
    } = params;

    const { start, end } = normalizeRangeForQuery(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = await buildDetailFilialFilter(
      request,
      company,
      filial,
      'vp.FILIAL',
      'filialDesc'
    );

    let vendedorFilter = '';
    if (vendedor && vendedor.trim()) {
      request.input('vendedorApelidoDesc', sql.VarChar, vendedor.trim());
      const codigoResult = await request.query<{ codigo: string }>(`
        SELECT LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo
        FROM LOJA_VENDEDORES WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, CAST(VENDEDOR AS VARCHAR))))) = @vendedorApelidoDesc
      `);
      const codigos = (codigoResult.recordset ?? []).map((r) => r.codigo).filter(Boolean);
      if (codigos.length === 0) codigos.push(vendedor.trim());
      codigos.forEach((c, i) => request.input(`vdesc${i}`, sql.VarChar, c));
      vendedorFilter = `AND vp.VENDEDOR IN (${codigos.map((_, i) => `@vdesc${i}`).join(', ')})`;
    }

    const grupoFilter = buildListFilter(request, "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')", grupos, 'grupoDesc');
    const linhaFilter = buildListFilter(request, "COALESCE(vp.LINHA, p.LINHA, '')", linhas, 'linhaDesc');
    const colecaoFilter = buildListFilter(request, "COALESCE(vp.COLECAO, p.COLECAO, '')", colecoes, 'colecaoDesc');
    const subgrupoFilter = buildListFilter(request, "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')", subgrupos, 'subgrupoDesc');
    const gradeFilter = buildListFilter(request, 'CONVERT(VARCHAR, p.GRADE)', grades, 'gradeDesc');

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoIdDesc', sql.VarChar, produtoId);
      produtoFilter = 'AND vp.PRODUTO = @produtoIdDesc';
    } else if ((produtoSearchTerm?.trim() ?? '').length >= 2) {
      request.input('produtoSearchTermDesc', sql.VarChar, `%${(produtoSearchTerm ?? '').trim()}%`);
      produtoFilter = 'AND vp.DESC_PRODUTO LIKE @produtoSearchTermDesc';
    }

    const topClamp = Math.min(Math.max(limit || 100, 1), 1000);
    const corCodigoSelect = porCor ? 'MAX(vp.COR_PRODUTO) AS corCodigo,' : `'' AS corCodigo,`;
    const corDescSelect = porCor ? "MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS cor," : `'' AS cor,`;
    const groupBy = porCor ? 'vp.PRODUTO, vp.COR_PRODUTO' : 'vp.PRODUTO';

    const query = `
      SELECT TOP (${topClamp})
        vp.PRODUTO AS produto,
        MAX(vp.DESC_PRODUTO) AS descricao,
        ${corCodigoSelect}
        ${corDescSelect}
        MAX(ISNULL(vp.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(vp.LINHA, p.LINHA, '')) AS linha,
        MAX(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(COALESCE(vp.COLECAO, p.COLECAO, '')) AS colecao,
        MAX(ISNULL(CONVERT(VARCHAR, p.GRADE), '')) AS grade,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS quantidade,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END) AS faturamento,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE ISNULL(vp.DESCONTO_VENDA, 0) END) AS desconto
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      ${porCor ? 'LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR' : ''}
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${vendedorFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
      GROUP BY ${groupBy}
      HAVING SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE ISNULL(vp.DESCONTO_VENDA, 0) END) > 0
      ORDER BY desconto DESC
    `;

    const result = await request.query<{
      produto: string;
      descricao: string;
      corCodigo: string;
      cor: string;
      grupo: string;
      linha: string;
      subgrupo: string;
      colecao: string;
      grade: string;
      quantidade: number;
      faturamento: number;
      desconto: number;
    }>(query);

    return result.recordset.map((row) => {
      const faturamento = Number(row.faturamento ?? 0);
      const desconto = Number(row.desconto ?? 0);
      const bruto = faturamento + desconto;
      return {
        produto: (row.produto ?? '').trim(),
        descricao: row.descricao || 'SEM DESCRIÇÃO',
        cor: row.cor?.trim() || undefined,
        corCodigo: row.corCodigo?.trim() || undefined,
        grupo: row.grupo?.trim() || undefined,
        linha: row.linha?.trim() || undefined,
        subgrupo: row.subgrupo?.trim() || undefined,
        colecao: row.colecao?.trim() || undefined,
        grade: row.grade?.trim() || undefined,
        quantidade: Number(row.quantidade ?? 0),
        faturamento,
        desconto,
        descontoPct: bruto > 0 ? Number(((desconto / bruto) * 100).toFixed(1)) : 0,
      };
    });
  });
}
