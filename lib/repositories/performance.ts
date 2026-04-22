import sql from 'mssql';
import { withRequest } from '@/lib/db/connection';
import { resolveCompany, type CompanyKey } from '@/lib/config/company';
import { shiftRangeByMonths, type NormalizedRange } from '@/lib/utils/date';

export interface PerformanceCategoryRow {
  filial: string;
  categoria: string;
  vendas: number;
  qtde: number;
}

export interface PerformanceDataResult {
  current: PerformanceCategoryRow[];
  previous: PerformanceCategoryRow[];
}

/** Filiais que não fazem venda ao público (depósito/matriz) por empresa */
const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ['SCARF ME - MATRIZ'],
  nerd: ['NERD'],
};

function normalizeFilialFilterValue(value: string): string {
  return value
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function buildNormalizedFilialSqlExpr(column: string): string {
  return `
    UPPER(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(LTRIM(RTRIM(ISNULL(${column}, ''))), NCHAR(0x00A0), ' '),
                CHAR(9), ' '
              ),
              NCHAR(0x2010), '-'
            ),
            NCHAR(0x2011), '-'
          ),
          NCHAR(0x2013), '-'
        ),
        '  ', ' '
      )
    )
  `;
}

export async function fetchPerformanceData(
  companyKey: CompanyKey,
  range: NormalizedRange,
  comparisonMode: 'month' | 'year' = 'month'
): Promise<PerformanceDataResult> {
  const company = resolveCompany(companyKey);
  if (!company) return { current: [], previous: [] };

  const matrizFiliais = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const ecommerceSet = new Set(ecommerceFilials);

  // Filiais POS: excluir matriz e ecommerce (ecommerce usa tabela diferente)
  const posFiliais = company.filialFilters.sales.filter(
    f => !matrizFiliais.has(f) && !ecommerceSet.has(f)
  );

  // Range deve vir normalizado para UTC: start no início do dia e end exclusivo (início do próximo dia)
  const startCurrent = range.start;
  const endCurrent = range.end;

  const previousRange = shiftRangeByMonths(range, comparisonMode === 'year' ? -12 : -1);
  const startPrevious = previousRange.start;
  const endPrevious = previousRange.end;

  // Categoria via tabela PRODUTOS (p) — LOJA_VENDA_PRODUTO não possui GRUPO_PRODUTO/LINHA
  const categoriaExpr = companyKey === 'nerd'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))))`
    : `UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))`;

  // Sem filtro de exclusão de categoria: todas as linhas/grupos contribuem para o total real de vendas.
  // Produtos com categoria vazia são incluídos na soma mas não aparecem como coluna (filtrado na API).

  /**
   * Query POS com mesmo cálculo da dashboard:
   * - LOJA_VENDA_PRODUTO para vendas brutas
   * - LOJA_VENDA_TROCA para deduções de troca (mesmo ticket + produto)
   * - TrocasPuras para devoluções puras (ticket sem linha correspondente em LOJA_VENDA_PRODUTO)
   * VALOR_LIQUIDO_CALC = (PRECO_LIQUIDO × QTDE) − DESCONTO_VENDA − VALOR_TROCA
   */
  const runPosQuery = (start: Date, end: Date, prefix: string): Promise<PerformanceCategoryRow[]> => {
    if (posFiliais.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}start`, sql.DateTime, start);
      request.input(`${prefix}end`, sql.DateTime, end);

      posFiliais.forEach((filial, i) => {
        request.input(`${prefix}f${i}`, sql.VarChar, filial);
      });
      const filialPlaceholders = posFiliais.map((_, i) => `@${prefix}f${i}`).join(', ');

      const query = `
        WITH vendas_base AS (
          SELECT
            vp.TICKET,
            vp.CODIGO_FILIAL,
            vp.PRODUTO,
            vp.COR_PRODUTO,
            vp.TAMANHO,
            vp.QTDE,
            vp.PRECO_LIQUIDO,
            f.FILIAL,
            ${categoriaExpr} AS CATEGORIA,
            CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK)
            ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @${prefix}start
            AND vp.DATA_VENDA < @${prefix}end
            AND f.FILIAL IN (${filialPlaceholders})
        ),
        trocas_item AS (
          SELECT
            vt.TICKET,
            vt.CODIGO_FILIAL,
            vt.PRODUTO,
            vt.COR_PRODUTO,
            vt.TAMANHO,
            SUM(vt.QTDE) AS QTDE_TROCA,
            CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
          WHERE vt.QTDE_CANCELADA = 0
            AND v.DATA_VENDA >= @${prefix}start AND v.DATA_VENDA < @${prefix}end
          GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
        ),
        TrocasPuras AS (
          SELECT
            f.FILIAL,
            ${categoriaExpr} AS CATEGORIA,
            CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
            (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vt.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK)
            ON p.PRODUTO = vt.PRODUTO
          WHERE vt.QTDE_CANCELADA = 0
            AND v.DATA_VENDA >= @${prefix}start
            AND v.DATA_VENDA < @${prefix}end
            AND NOT EXISTS (
              SELECT 1 FROM LOJA_VENDA_PRODUTO vp2 WITH (NOLOCK)
              WHERE vp2.TICKET = vt.TICKET
                AND vp2.CODIGO_FILIAL = vt.CODIGO_FILIAL
                AND vp2.PRODUTO = vt.PRODUTO
                AND ISNULL(vp2.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
                AND ISNULL(vp2.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
            )
            AND f.FILIAL IN (${filialPlaceholders})
        ),
        VendasComNumero AS (
          SELECT
            vb.FILIAL,
            vb.CATEGORIA,
            vb.TICKET,
            vb.CODIGO_FILIAL,
            vb.PRODUTO,
            vb.COR_PRODUTO,
            vb.TAMANHO,
            vb.QTDE,
            vb.PRECO_LIQUIDO,
            vb.DESCONTO_VENDA,
            ROW_NUMBER() OVER (
              PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
              ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ) AS RN
          FROM vendas_base vb
        ),
        MovimentoUnificado AS (
          SELECT
            vcn.FILIAL,
            vcn.CATEGORIA,
            CAST(
              CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6))
              - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6))
              - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))
            AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
            (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
          FROM VendasComNumero vcn
          LEFT JOIN trocas_item ti
            ON ti.TICKET = vcn.TICKET
            AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
            AND ti.PRODUTO = vcn.PRODUTO
            AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
            AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
          UNION ALL
          SELECT
            tp.FILIAL,
            tp.CATEGORIA,
            tp.VALOR_LIQUIDO_CALC,
            tp.QTDE_LIQUIDA_CALC
          FROM TrocasPuras tp
        )
        SELECT
          FILIAL,
          CATEGORIA,
          SUM(VALOR_LIQUIDO_CALC) AS VENDAS,
          SUM(QTDE_LIQUIDA_CALC) AS QTDE
        FROM MovimentoUnificado
        WHERE FILIAL IS NOT NULL AND CATEGORIA IS NOT NULL
        GROUP BY FILIAL, CATEGORIA
        ORDER BY FILIAL, VENDAS DESC
      `;

      const result = await request.query(query);
      return (result.recordset as Record<string, unknown>[]).map(row => ({
        filial: String(row.FILIAL ?? '').trim(),
        categoria: String(row.CATEGORIA ?? '').trim(),
        vendas: Number(row.VENDAS ?? 0),
        qtde: Number(row.QTDE ?? 0),
      })).filter(row => row.filial);
    });
  };

  // Query Ecommerce (FATURAMENTO + W_FATURAMENTO_PROD_02)
  const runEcommerceQuery = (start: Date, end: Date, prefix: string): Promise<PerformanceCategoryRow[]> => {
    if (ecommerceFilials.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}ecomStart`, sql.DateTime, start);
      request.input(`${prefix}ecomEnd`, sql.DateTime, end);

      ecommerceFilials.forEach((filial, i) => {
        request.input(`${prefix}ecomF${i}`, sql.VarChar, filial);
      });
      const filialPlaceholders = ecommerceFilials.map((_, i) => `@${prefix}ecomF${i}`).join(', ');

      const query = `
        SELECT
          f.FILIAL,
          ${categoriaExpr} AS CATEGORIA,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS VENDAS,
          SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) AS QTDE
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = fp.PRODUTO
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@${prefix}ecomStart AS DATE)
          AND CAST(f.EMISSAO AS DATE) < CAST(@${prefix}ecomEnd AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${filialPlaceholders})
        GROUP BY f.FILIAL, ${categoriaExpr}
        ORDER BY f.FILIAL, VENDAS DESC
      `;

      const result = await request.query(query);
      return (result.recordset as Record<string, unknown>[]).map(row => ({
        filial: String(row.FILIAL ?? '').trim(),
        categoria: String(row.CATEGORIA ?? '').trim(),
        vendas: Number(row.VENDAS ?? 0),
        qtde: Number(row.QTDE ?? 0),
      })).filter(row => row.filial);
    });
  };

  const [posCurrent, posPrevious, ecomCurrent, ecomPrevious] = await Promise.all([
    runPosQuery(startCurrent, endCurrent, 'cur'),
    runPosQuery(startPrevious, endPrevious, 'prev'),
    runEcommerceQuery(startCurrent, endCurrent, 'cur'),
    runEcommerceQuery(startPrevious, endPrevious, 'prev'),
  ]);

  return {
    current: [...posCurrent, ...ecomCurrent],
    previous: [...posPrevious, ...ecomPrevious],
  };
}

export interface FilialProdutoSalesRow {
  produto: string;
  descricao: string;
  categoria: string;
  subgrupo?: string;
  grade: string;
  /** Código de cor (COR_PRODUTO) quando agrupado por cor */
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
}

export interface FilialProdutoVendedorSalesRow {
  vendedor: string;
  produto: string;
  descricao: string;
  categoria: string;
  grade: string;
  vendas: number;
  qtde: number;
  vendasPrevious: number;
}

function filialProdutoMergeKey(r: FilialProdutoSalesRow, groupByCor: boolean): string {
  const cor = groupByCor ? (r.cor ?? '').trim() : '';
  return `${r.produto}||${r.categoria}||${r.grade}||${cor}`;
}

export async function fetchFilialProdutoSales(
  companyKey: CompanyKey,
  posFilialNames: string[],
  ecommerceFilialNames: string[],
  range: NormalizedRange,
  comparisonMode: 'month' | 'year' = 'month',
  options?: { groupByCor?: boolean; limit?: number },
): Promise<FilialProdutoSalesRow[]> {
  const groupByCor = options?.groupByCor === true;
  const start = range.start;
  const end = range.end;
  const prev = shiftRangeByMonths(range, comparisonMode === 'year' ? -12 : -1);
  const startPrev = prev.start;
  const endPrev = prev.end;

  const categoriaExpr = companyKey === 'nerd'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))))`
    : `UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))`;
  const gradeExpr = companyKey === 'scarfme'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRADE, ''))))`
    : `''`;
  // SQL Server rejects GROUP BY on a literal constant — only include gradeExpr if it references a column
  const gradeGroupBy = gradeExpr === `''` ? '' : `, ${gradeExpr}`;
  const requestedLimit = Number(options?.limit ?? NaN);
  const topN = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : groupByCor ? 2000 : 500;

  type RawRow = {
    PRODUTO: string;
    DESCRICAO: string;
    CATEGORIA: string;
    SUBGRUPO?: string;
    GRADE: string;
    CODIGO_BARRA?: string;
    COR_PRODUTO?: string;
    COR_DESCRICAO?: string;
    CUSTO_UNIT: number;
    QTDE: number;
    VENDAS: number;
  };

  const mapRow = (r: RawRow): FilialProdutoSalesRow => {
    const base: FilialProdutoSalesRow = {
      produto: r.PRODUTO?.trim() ?? '',
      descricao: r.DESCRICAO?.trim() ?? '',
      categoria: r.CATEGORIA?.trim() ?? '',
      subgrupo: r.SUBGRUPO?.trim() ?? '',
      grade: r.GRADE?.trim() ?? '',
      codigoBarra: r.CODIGO_BARRA?.trim() ?? '',
      custo: Number(r.CUSTO_UNIT ?? 0),
      vendas: Math.round(Number(r.VENDAS ?? 0)),
      qtde: Math.round(Number(r.QTDE ?? 0)),
      vendasPrevious: 0,
    };
    if (groupByCor) {
      base.cor = r.COR_PRODUTO?.trim() ?? '';
      base.corDescricao = r.COR_DESCRICAO?.trim() ?? '';
    }
    return base;
  };

  const runPos = (s: Date, e: Date, prefix: string): Promise<FilialProdutoSalesRow[]> => {
    if (posFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}Start`, sql.DateTime, s);
      request.input(`${prefix}End`, sql.DateTime, e);
      posFilialNames.forEach((f, i) => request.input(`${prefix}F${i}`, sql.VarChar, f));
      const placeholders = posFilialNames.map((_, i) => `@${prefix}F${i}`).join(', ');
      const corSelect = groupByCor
        ? `ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
          MAX(ISNULL(COALESCE(cor_ref.DESC_COR, vp.DESC_COR_PRODUTO), '')) AS COR_DESCRICAO,`
        : '';
      const corJoin = groupByCor
        ? 'LEFT JOIN CORES_BASICAS cor_ref WITH (NOLOCK) ON cor_ref.COR = vp.COR_PRODUTO'
        : '';
      const corGroupBy = groupByCor ? ', ISNULL(vp.COR_PRODUTO, \'\')' : '';
      const query = `
        SELECT TOP ${topN}
          ISNULL(vp.PRODUTO, '') AS PRODUTO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          ${categoriaExpr} AS CATEGORIA,
          MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))) AS SUBGRUPO,
          ${gradeExpr} AS GRADE,
          MAX(ISNULL(pbsel.CODIGO_BARRA, '')) AS CODIGO_BARRA,
          ${corSelect}
          ISNULL(p.CUSTO_REPOSICAO1, 0) AS CUSTO_UNIT,
          SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS QTDE,
          SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) AS VENDAS
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
        OUTER APPLY (
          SELECT TOP 1 pb.CODIGO_BARRA
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE pb.PRODUTO = vp.PRODUTO
            AND pb.CODIGO_BARRA IS NOT NULL
            AND pb.CODIGO_BARRA <> ''
            ${groupByCor ? "AND ISNULL(pb.COR_PRODUTO, '') = ISNULL(vp.COR_PRODUTO, '')" : ''}
          ORDER BY pb.CODIGO_BARRA
        ) pbsel
        ${corJoin}
        WHERE vp.DATA_VENDA >= @${prefix}Start
          AND vp.DATA_VENDA < @${prefix}End
          AND vp.QTDE > 0
          AND vp.FILIAL IN (${placeholders})
        GROUP BY ISNULL(vp.PRODUTO, ''), UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))), ${categoriaExpr}${gradeGroupBy}, ISNULL(p.CUSTO_REPOSICAO1, 0)${corGroupBy}
        HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) > 0
        ORDER BY VENDAS DESC
      `;
      const result = await request.query<RawRow>(query);
      return result.recordset.map(mapRow).filter(r => r.produto !== '');
    });
  };

  const runEcom = (s: Date, e: Date, prefix: string): Promise<FilialProdutoSalesRow[]> => {
    if (ecommerceFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}EcomStart`, sql.DateTime, s);
      request.input(`${prefix}EcomEnd`, sql.DateTime, e);
      ecommerceFilialNames.forEach((f, i) => request.input(`${prefix}EcomF${i}`, sql.VarChar, f));
      const placeholders = ecommerceFilialNames.map((_, i) => `@${prefix}EcomF${i}`).join(', ');
      const corSelect = groupByCor
        ? `ISNULL(fp.COR_PRODUTO, '') AS COR_PRODUTO,
          MAX(ISNULL(cor_ref.DESC_COR, '')) AS COR_DESCRICAO,`
        : '';
      const corJoin = groupByCor
        ? 'LEFT JOIN CORES_BASICAS cor_ref WITH (NOLOCK) ON cor_ref.COR = fp.COR_PRODUTO'
        : '';
      const corGroupBy = groupByCor ? ', ISNULL(fp.COR_PRODUTO, \'\')' : '';
      const query = `
        SELECT TOP ${topN}
          ISNULL(fp.PRODUTO, '') AS PRODUTO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          ${categoriaExpr} AS CATEGORIA,
          MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))) AS SUBGRUPO,
          ${gradeExpr} AS GRADE,
          MAX(ISNULL(pbsel.CODIGO_BARRA, '')) AS CODIGO_BARRA,
          ${corSelect}
          ISNULL(p.CUSTO_REPOSICAO1, 0) AS CUSTO_UNIT,
          SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) AS QTDE,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS VENDAS
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        OUTER APPLY (
          SELECT TOP 1 pb.CODIGO_BARRA
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE pb.PRODUTO = fp.PRODUTO
            AND pb.CODIGO_BARRA IS NOT NULL
            AND pb.CODIGO_BARRA <> ''
          ORDER BY pb.CODIGO_BARRA
        ) pbsel
        ${corJoin}
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@${prefix}EcomStart AS DATE)
          AND CAST(f.EMISSAO AS DATE) < CAST(@${prefix}EcomEnd AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
        GROUP BY ISNULL(fp.PRODUTO, ''), UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))), ${categoriaExpr}${gradeGroupBy}, ISNULL(p.CUSTO_REPOSICAO1, 0)${corGroupBy}
        HAVING SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) > 0
        ORDER BY VENDAS DESC
      `;
      const result = await request.query<RawRow>(query);
      return result.recordset.map(mapRow).filter(r => r.produto !== '');
    });
  };

  const [posCur, ecomCur, posPrev, ecomPrev] = await Promise.all([
    runPos(start, end, 'fp'),
    runEcom(start, end, 'fp'),
    runPos(startPrev, endPrev, 'fpp'),
    runEcom(startPrev, endPrev, 'fpp'),
  ]);

  const merged = new Map<string, FilialProdutoSalesRow>();
  [...posCur, ...ecomCur].forEach(r => {
    const key = filialProdutoMergeKey(r, groupByCor);
    const existing = merged.get(key);
    if (existing) {
      existing.vendas += r.vendas;
      existing.qtde += r.qtde;
      if (existing.custo === 0 && r.custo > 0) existing.custo = r.custo;
    } else {
      merged.set(key, { ...r });
    }
  });

  const prevMap = new Map<string, number>();
  [...posPrev, ...ecomPrev].forEach(r => {
    const key = filialProdutoMergeKey(r, groupByCor);
    prevMap.set(key, (prevMap.get(key) ?? 0) + r.vendas);
  });

  merged.forEach(row => {
    row.vendasPrevious = prevMap.get(filialProdutoMergeKey(row, groupByCor)) ?? 0;
  });

  return Array.from(merged.values()).sort((a, b) => b.vendas - a.vendas);
}

export interface ProdutoQtdePorFilialRow {
  produto: string;
  /** COR_PRODUTO quando groupByCor; senão string vazia */
  cor: string;
  filial: string;
  qtde: number;
}

/**
 * Retorna a quantidade vendida de cada produto, decomposta por filial.
 * Usado para popular tooltips de "onde vendeu" na visão geral.
 */
export async function fetchProdutoQtdePorFilial(
  _companyKey: CompanyKey,
  posFilialNames: string[],
  ecommerceFilialNames: string[],
  range: NormalizedRange,
  options?: { groupByCor?: boolean },
): Promise<ProdutoQtdePorFilialRow[]> {
  const groupByCor = options?.groupByCor === true;
  const start = range.start;
  const end = range.end;

  type RawRow = { PRODUTO: string; FILIAL: string; QTDE: number; COR_PRODUTO?: string };

  const runPos = (): Promise<ProdutoQtdePorFilialRow[]> => {
    if (posFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input('qtdStart', sql.DateTime, start);
      request.input('qtdEnd', sql.DateTime, end);
      posFilialNames.forEach((f, i) => request.input(`qtdF${i}`, sql.VarChar, f));
      const placeholders = posFilialNames.map((_, i) => `@qtdF${i}`).join(', ');
      const corSelect = groupByCor ? 'ISNULL(vp.COR_PRODUTO, \'\') AS COR_PRODUTO,' : '';
      const corGroup = groupByCor ? ', ISNULL(vp.COR_PRODUTO, \'\')' : '';
      const query = `
        SELECT
          ISNULL(vp.PRODUTO, '') AS PRODUTO,
          ${corSelect}
          ISNULL(vp.FILIAL, '') AS FILIAL,
          SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS QTDE
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @qtdStart
          AND vp.DATA_VENDA < @qtdEnd
          AND vp.QTDE > 0
          AND vp.FILIAL IN (${placeholders})
        GROUP BY ISNULL(vp.PRODUTO, ''), ISNULL(vp.FILIAL, '')${corGroup}
        HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) > 0
      `;
      const result = await request.query<RawRow>(query);
      return result.recordset
        .map(r => ({
          produto: r.PRODUTO?.trim() ?? '',
          cor: groupByCor ? (r.COR_PRODUTO?.trim() ?? '') : '',
          filial: r.FILIAL?.trim() ?? '',
          qtde: Math.round(Number(r.QTDE ?? 0)),
        }))
        .filter(r => r.produto !== '');
    });
  };

  const runEcom = (): Promise<ProdutoQtdePorFilialRow[]> => {
    if (ecommerceFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input('qtdEcomStart', sql.DateTime, start);
      request.input('qtdEcomEnd', sql.DateTime, end);
      ecommerceFilialNames.forEach((f, i) => request.input(`qtdEcomF${i}`, sql.VarChar, f));
      const placeholders = ecommerceFilialNames.map((_, i) => `@qtdEcomF${i}`).join(', ');
      const corSelect = groupByCor ? 'ISNULL(fp.COR_PRODUTO, \'\') AS COR_PRODUTO,' : '';
      const corGroup = groupByCor ? ', ISNULL(fp.COR_PRODUTO, \'\')' : '';
      const query = `
        SELECT
          ISNULL(fp.PRODUTO, '') AS PRODUTO,
          ${corSelect}
          ISNULL(f.FILIAL, '') AS FILIAL,
          SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) AS QTDE
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@qtdEcomStart AS DATE)
          AND CAST(f.EMISSAO AS DATE) < CAST(@qtdEcomEnd AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
        GROUP BY ISNULL(fp.PRODUTO, ''), ISNULL(f.FILIAL, '')${corGroup}
        HAVING SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) > 0
      `;
      const result = await request.query<RawRow>(query);
      return result.recordset
        .map(r => ({
          produto: r.PRODUTO?.trim() ?? '',
          cor: groupByCor ? (r.COR_PRODUTO?.trim() ?? '') : '',
          filial: r.FILIAL?.trim() ?? '',
          qtde: Math.round(Number(r.QTDE ?? 0)),
        }))
        .filter(r => r.produto !== '');
    });
  };

  const [posRows, ecomRows] = await Promise.all([runPos(), runEcom()]);
  const merged = new Map<string, ProdutoQtdePorFilialRow>();
  for (const r of [...posRows, ...ecomRows]) {
    const k = `${r.produto}||${r.cor}||${r.filial}`;
    const ex = merged.get(k);
    if (ex) ex.qtde += r.qtde;
    else merged.set(k, { ...r });
  }
  return Array.from(merged.values());
}

export interface ProdutoEstoquePorFilialRow {
  produto: string;
  cor: string;
  filial: string;
  estoque: number;
}

/**
 * Estoque líquido por produto e filial (e opcionalmente por cor).
 * Usado na Curva ABC para coluna de estoque e tooltip por filial.
 */
export async function fetchProdutoEstoquePorFilial(
  _companyKey: CompanyKey,
  posFilialNames: string[],
  ecommerceFilialNames: string[],
  options?: { groupByCor?: boolean },
): Promise<ProdutoEstoquePorFilialRow[]> {
  const groupByCor = options?.groupByCor === true;
  const allFiliais = [...new Set([...posFilialNames, ...ecommerceFilialNames])];
  if (allFiliais.length === 0) return [];

  return withRequest(async (request) => {
    allFiliais.forEach((f, i) => request.input(`estF${i}`, sql.VarChar, normalizeFilialFilterValue(f)));
    const placeholders = allFiliais.map((_, i) => `@estF${i}`).join(', ');
    const corSelect = groupByCor ? 'ISNULL(e.COR_PRODUTO, \'\') AS COR_PRODUTO,' : '';
    const corGroup = groupByCor ? ', ISNULL(e.COR_PRODUTO, \'\')' : '';
    const filialExpr = buildNormalizedFilialSqlExpr('e.FILIAL');
    const query = `
      SELECT
        ISNULL(e.PRODUTO, '') AS PRODUTO,
        ${corSelect}
        ISNULL(e.FILIAL, '') AS FILIAL,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS POSITIVE_STOCK,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) < 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS NEGATIVE_STOCK,
        COUNT(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN 1 END) AS POSITIVE_COUNT
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE ${filialExpr} IN (${placeholders})
      GROUP BY ISNULL(e.PRODUTO, ''), ISNULL(e.FILIAL, '')${corGroup}
      HAVING ABS(SUM(ISNULL(e.ESTOQUE, 0))) > 0
    `;
    type RawRow = {
      PRODUTO: string;
      FILIAL: string;
      POSITIVE_STOCK: number;
      NEGATIVE_STOCK: number;
      POSITIVE_COUNT: number;
      COR_PRODUTO?: string;
    };
    const result = await request.query<RawRow>(query);
    return result.recordset
      .map(r => {
        const positiveStock = Number(r.POSITIVE_STOCK ?? 0);
        const negativeStock = Number(r.NEGATIVE_STOCK ?? 0);
        const positiveCount = Number(r.POSITIVE_COUNT ?? 0);
        const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);

        return {
          produto: r.PRODUTO?.trim() ?? '',
          cor: groupByCor ? (r.COR_PRODUTO?.trim() ?? '') : '',
          filial: r.FILIAL?.trim() ?? '',
          estoque: Math.round(finalStock),
        };
      })
      .filter(r => r.produto !== '');
  });
}

export interface ProdutoEstoqueDetalhadoPorFilialRow {
  produto: string;
  descricao: string;
  categoria: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  corDescricao?: string;
  filial: string;
  estoque: number;
}

export async function fetchProdutoEstoqueDetalhadoPorFilial(
  companyKey: CompanyKey,
  posFilialNames: string[],
  ecommerceFilialNames: string[],
  options?: { groupByCor?: boolean },
): Promise<ProdutoEstoqueDetalhadoPorFilialRow[]> {
  const groupByCor = options?.groupByCor === true;
  const allFiliais = [...new Set([...posFilialNames, ...ecommerceFilialNames])];
  if (allFiliais.length === 0) return [];

  const categoriaExpr = companyKey === 'nerd'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))))`
    : `UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))`;
  const gradeExpr = companyKey === 'scarfme'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRADE, ''))))`
    : `''`;
  const gradeGroup = gradeExpr === `''` ? '' : `, ${gradeExpr}`;

  return withRequest(async (request) => {
    allFiliais.forEach((f, i) => request.input(`estDetF${i}`, sql.VarChar, normalizeFilialFilterValue(f)));
    const placeholders = allFiliais.map((_, i) => `@estDetF${i}`).join(', ');
    const corSelect = groupByCor
      ? `ISNULL(e.COR_PRODUTO, '') AS COR_PRODUTO,
          MAX(ISNULL(cor_ref.DESC_COR, '')) AS COR_DESCRICAO,`
      : '';
    const corJoin = groupByCor
      ? 'LEFT JOIN CORES_BASICAS cor_ref WITH (NOLOCK) ON cor_ref.COR = e.COR_PRODUTO'
      : '';
    const corGroup = groupByCor ? `, ISNULL(e.COR_PRODUTO, '')` : '';
    const filialExpr = buildNormalizedFilialSqlExpr('e.FILIAL');

    const query = `
      SELECT
        ISNULL(e.PRODUTO, '') AS PRODUTO,
        UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
        ${categoriaExpr} AS CATEGORIA,
        MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))) AS SUBGRUPO,
        ${gradeExpr} AS GRADE,
        ${corSelect}
        ISNULL(e.FILIAL, '') AS FILIAL,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS POSITIVE_STOCK,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) < 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS NEGATIVE_STOCK,
        COUNT(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN 1 END) AS POSITIVE_COUNT
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON p.PRODUTO = e.PRODUTO
      ${corJoin}
      WHERE ${filialExpr} IN (${placeholders})
      GROUP BY
        ISNULL(e.PRODUTO, ''),
        UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
        ${categoriaExpr},
        ISNULL(e.FILIAL, '')${gradeGroup}${corGroup}
      HAVING ABS(SUM(ISNULL(e.ESTOQUE, 0))) > 0
      ORDER BY SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) DESC
    `;

    type RawRow = {
      PRODUTO: string;
      DESCRICAO: string;
      CATEGORIA: string;
      SUBGRUPO?: string;
      GRADE?: string;
      COR_PRODUTO?: string;
      COR_DESCRICAO?: string;
      FILIAL: string;
      POSITIVE_STOCK: number;
      NEGATIVE_STOCK: number;
      POSITIVE_COUNT: number;
    };

    const result = await request.query<RawRow>(query);
    return result.recordset
      .map((row) => {
        const positiveStock = Number(row.POSITIVE_STOCK ?? 0);
        const negativeStock = Number(row.NEGATIVE_STOCK ?? 0);
        const positiveCount = Number(row.POSITIVE_COUNT ?? 0);
        const finalStock = positiveCount > 0 ? positiveStock : (positiveStock + negativeStock);

        return {
          produto: row.PRODUTO?.trim() ?? '',
          descricao: row.DESCRICAO?.trim() ?? '',
          categoria: row.CATEGORIA?.trim() ?? '',
          subgrupo: row.SUBGRUPO?.trim() ?? '',
          grade: row.GRADE?.trim() ?? '',
          cor: groupByCor ? (row.COR_PRODUTO?.trim() ?? '') : '',
          corDescricao: groupByCor ? (row.COR_DESCRICAO?.trim() ?? '') : '',
          filial: row.FILIAL?.trim() ?? '',
          estoque: Math.round(finalStock),
        };
      })
      .filter((row) => row.produto !== '');
  });
}

export async function fetchFilialProdutoVendedorSales(
  companyKey: CompanyKey,
  posFilialNames: string[],
  ecommerceFilialNames: string[],
  range: NormalizedRange,
  comparisonMode: 'month' | 'year' = 'month',
): Promise<FilialProdutoVendedorSalesRow[]> {
  const start = range.start;
  const end = range.end;
  const prev = shiftRangeByMonths(range, comparisonMode === 'year' ? -12 : -1);
  const startPrev = prev.start;
  const endPrev = prev.end;

  const categoriaExpr = companyKey === 'nerd'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))))`
    : `UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))`;
  const gradeExpr = companyKey === 'scarfme'
    ? `UPPER(LTRIM(RTRIM(ISNULL(p.GRADE, ''))))`
    : `''`;
  const gradeGroupBy = gradeExpr === `''` ? '' : `, ${gradeExpr}`;

  type RawRow = {
    VENDEDOR: string;
    VENDEDOR_APELIDO: string;
    PRODUTO: string;
    DESCRICAO: string;
    CATEGORIA: string;
    GRADE: string;
    QTDE: number;
    VENDAS: number;
  };

  const runPos = (s: Date, e: Date, prefix: string): Promise<Array<Omit<FilialProdutoVendedorSalesRow, 'vendasPrevious'>>> => {
    if (posFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}Start`, sql.DateTime, s);
      request.input(`${prefix}End`, sql.DateTime, e);
      posFilialNames.forEach((f, i) => request.input(`${prefix}F${i}`, sql.VarChar, f));
      const placeholders = posFilialNames.map((_, i) => `@${prefix}F${i}`).join(', ');

      const query = `
        SELECT TOP 5000
          ISNULL(
            LTRIM(RTRIM(lv.VENDEDOR_APELIDO)),
            ISNULL(LTRIM(RTRIM(lv.NOME_VENDEDOR)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))))
          ) AS VENDEDOR_APELIDO,
          ISNULL(vp.PRODUTO, '') AS PRODUTO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          ${categoriaExpr} AS CATEGORIA,
          ${gradeExpr} AS GRADE,
          SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS QTDE,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0))
            END
          ) AS VENDAS
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
        LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
          ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
        WHERE vp.DATA_VENDA >= @${prefix}Start
          AND vp.DATA_VENDA < @${prefix}End
          AND vp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
          AND v.VENDEDOR IS NOT NULL
        GROUP BY
          ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), ISNULL(LTRIM(RTRIM(lv.NOME_VENDEDOR)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))))),
          ISNULL(vp.PRODUTO, ''),
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
          ${categoriaExpr}${gradeGroupBy}
        HAVING SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0))
          END
        ) > 0
        ORDER BY VENDAS DESC
      `;

      const result = await request.query<RawRow>(query);
      return result.recordset.map(r => ({
        vendedor: (r.VENDEDOR_APELIDO ?? r.VENDEDOR ?? '').trim() || 'SEM VENDEDOR',
        produto: r.PRODUTO?.trim() ?? '',
        descricao: r.DESCRICAO?.trim() ?? '',
        categoria: r.CATEGORIA?.trim() ?? '',
        grade: r.GRADE?.trim() ?? '',
        vendas: Math.round(Number(r.VENDAS ?? 0)),
        qtde: Math.round(Number(r.QTDE ?? 0)),
      })).filter(r => r.produto !== '');
    });
  };

  // Ecommerce: não há vendedor por item; agregamos como "ECOMMERCE"
  const runEcom = (s: Date, e: Date, prefix: string): Promise<Array<Omit<FilialProdutoVendedorSalesRow, 'vendasPrevious'>>> => {
    if (ecommerceFilialNames.length === 0) return Promise.resolve([]);
    return withRequest(async (request) => {
      request.input(`${prefix}EcomStart`, sql.DateTime, s);
      request.input(`${prefix}EcomEnd`, sql.DateTime, e);
      ecommerceFilialNames.forEach((f, i) => request.input(`${prefix}EcomF${i}`, sql.VarChar, f));
      const placeholders = ecommerceFilialNames.map((_, i) => `@${prefix}EcomF${i}`).join(', ');

      const query = `
        SELECT TOP 5000
          ISNULL(fp.PRODUTO, '') AS PRODUTO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          ${categoriaExpr} AS CATEGORIA,
          ${gradeExpr} AS GRADE,
          SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) AS QTDE,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS VENDAS
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@${prefix}EcomStart AS DATE)
          AND CAST(f.EMISSAO AS DATE) < CAST(@${prefix}EcomEnd AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND f.FILIAL IN (${placeholders})
        GROUP BY ISNULL(fp.PRODUTO, ''), UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))), ${categoriaExpr}${gradeGroupBy}
        HAVING SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) > 0
        ORDER BY VENDAS DESC
      `;

      const result = await request.query<{ PRODUTO: string; DESCRICAO: string; CATEGORIA: string; GRADE: string; QTDE: number; VENDAS: number }>(query);
      return result.recordset.map(r => ({
        vendedor: 'ECOMMERCE',
        produto: r.PRODUTO?.trim() ?? '',
        descricao: r.DESCRICAO?.trim() ?? '',
        categoria: r.CATEGORIA?.trim() ?? '',
        grade: r.GRADE?.trim() ?? '',
        vendas: Math.round(Number(r.VENDAS ?? 0)),
        qtde: Math.round(Number(r.QTDE ?? 0)),
      })).filter(r => r.produto !== '');
    });
  };

  const [posCur, ecomCur, posPrev, ecomPrev] = await Promise.all([
    runPos(start, end, 'pvc'),
    runEcom(start, end, 'pvc'),
    runPos(startPrev, endPrev, 'pvp'),
    runEcom(startPrev, endPrev, 'pvp'),
  ]);

  const merged = new Map<string, FilialProdutoVendedorSalesRow>();
  [...posCur, ...ecomCur].forEach(r => {
    const key = `${r.vendedor}||${r.produto}||${r.categoria}||${r.grade}`;
    const existing = merged.get(key);
    if (existing) {
      existing.vendas += r.vendas;
      existing.qtde += r.qtde;
    } else {
      merged.set(key, { ...r, vendasPrevious: 0 });
    }
  });

  const prevMap = new Map<string, number>();
  [...posPrev, ...ecomPrev].forEach(r => {
    const key = `${r.vendedor}||${r.produto}||${r.categoria}||${r.grade}`;
    prevMap.set(key, (prevMap.get(key) ?? 0) + r.vendas);
  });

  merged.forEach((row, key) => {
    row.vendasPrevious = prevMap.get(key) ?? 0;
  });

  return Array.from(merged.values()).sort((a, b) => b.vendas - a.vendas);
}
