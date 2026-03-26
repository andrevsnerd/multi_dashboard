import sql from 'mssql';
import { withRequest } from '@/lib/db/connection';
import { resolveCompany, type CompanyKey } from '@/lib/config/company';

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

export async function fetchPerformanceData(
  companyKey: CompanyKey,
  month: number,
  year: number
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

  // Usar limites em UTC (início do dia) para bater com os ranges normalizados da dashboard.
  const startCurrent = new Date(Date.UTC(year, month, 1));
  const endCurrent = new Date(Date.UTC(year, month + 1, 1));

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const startPrevious = new Date(Date.UTC(prevYear, prevMonth, 1));
  const endPrevious = new Date(Date.UTC(prevYear, prevMonth + 1, 1));

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
            TICKET,
            CODIGO_FILIAL,
            PRODUTO,
            COR_PRODUTO,
            TAMANHO,
            SUM(QTDE) AS QTDE_TROCA,
            CAST(SUM(PRECO_LIQUIDO * QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
          FROM LOJA_VENDA_TROCA WITH (NOLOCK)
          WHERE QTDE_CANCELADA = 0
          GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
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
