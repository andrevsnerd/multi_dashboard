import "server-only";

import sql from "mssql";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import { withRequest } from "@/lib/db/connection";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { fetchFilialProdutoSales } from "@/lib/repositories/performance";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { syncProdutoLabelSet } from "@/lib/utils/produto-labels-store";

export const PRODUTO_NOVO_LABEL = "produto novo";
/**
 * Janela de novidade. Um produto é considerado novo se, dentro deste número de dias,
 * ele foi CADASTRADO ou teve sua PRIMEIRA ENTRADA de estoque na rede (o que vier primeiro).
 */
export const PRODUTOS_NOVOS_WINDOW_DAYS = 90;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Como o produto entrou no radar de "novo". */
export type ProdutoNovoOrigem = "cadastro" | "entrada" | "ambos";

export interface ProdutoNovoItem {
  produto: string;
  descricao: string;
  cor: string;
  corCodigo: string;
  linha?: string | null;
  /** Data de cadastramento (PRODUTOS.DATA_CADASTRAMENTO). */
  dataCadastro: string | null;
  /** Data da primeira entrada de estoque na rede (ESTOQUE_PROD_ENT / LOJA_ENTRADAS). */
  primeiraEntrada: string | null;
  /** Data em que o produto "surgiu" (menor sinal que o qualificou como novo). */
  surgeDate: string | null;
  /** Por que ele é novo: cadastro recente, primeira entrada recente ou ambos. */
  origem: ProdutoNovoOrigem;
  /** Faturamento líquido (com trocas) desde que surgiu — regra canônica de vendas. */
  vendas: number;
  /** Quantidade líquida vendida desde que surgiu. */
  qtde: number;
}

interface ProdutoNovoRow {
  produto: string;
  descricao: string;
  corCodigo: string;
  cor: string;
  linha: string | null;
  dataCadastro: string | null;
  primeiraEntrada: string | null;
  byCadastro: number;
  byEntrada: number;
}

function buildCompanyScopeFilter(request: sql.Request, company: CompanyKey): string {
  if (company === "nerd") {
    return `
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'ELETRONICOS'
    `;
  }

  const excludedLines = (resolveCompany(company)?.excludedLines ?? [])
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line !== "ELETRONICOS")
    .filter(Boolean);

  excludedLines.forEach((line, index) => {
    request.input(`excludedLine${index}`, sql.VarChar, line);
  });

  const notInExcludedLine =
    excludedLines.length > 0
      ? `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) NOT IN (${excludedLines
          .map((_, index) => `@excludedLine${index}`)
          .join(", ")})`
      : "";

  return `
    AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) <> ''
    ${notInExcludedLine}
  `;
}

function parseSqlDate(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const t = new Date(normalized).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Chaves de lookup de venda tolerantes ao formato do código de cor ('06' vs '6'). */
function corLookupKeys(produto: string, cor: string): string[] {
  const trimmed = (cor ?? "").trim();
  const keys = [`${produto}::${trimmed.toUpperCase()}`];
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(num)) {
    keys.push(`${produto}::#${num}`);
  }
  return keys;
}

/**
 * Busca os produtos novos da empresa. Um item entra na lista quando, nos últimos
 * PRODUTOS_NOVOS_WINDOW_DAYS dias, ele foi CADASTRADO ou teve sua PRIMEIRA ENTRADA
 * de estoque na rede — assim capturamos também o item que nunca vendeu mas acabou
 * de chegar. Cada linha (produto × cor) recebe a performance de vendas acumulada
 * desde que o produto surgiu, calculada pela regra canônica de vendas (com trocas).
 */
export async function fetchProdutosNovosRecentes(
  company: CompanyKey
): Promise<ProdutoNovoItem[]> {
  const items = await withRequest<ProdutoNovoItem[]>(async (request) => {
    request.input("windowDays", sql.Int, PRODUTOS_NOVOS_WINDOW_DAYS);

    const companyScopeFilter = buildCompanyScopeFilter(request as sql.Request, company);

    const query = `
      WITH recent_entries AS (
        SELECT PRODUTO, MIN(EMISSAO) AS primeiraEntrada
        FROM (
          SELECT pe.PRODUTO AS PRODUTO, e.EMISSAO AS EMISSAO
          FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
          JOIN ESTOQUE_PROD1_ENT pe WITH (NOLOCK)
            ON pe.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
          WHERE e.EMISSAO >= DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))

          UNION ALL

          SELECT lep.PRODUTO AS PRODUTO, le.EMISSAO AS EMISSAO
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
          WHERE le.EMISSAO >= DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
            AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
        ) r
        GROUP BY PRODUTO
      ),
      novos_entrada AS (
        -- Só conta como "novo por entrada" quem NÃO tem nenhuma entrada anterior à janela
        -- (evita falso-positivo de transferência de item antigo que ganhou romaneio agora).
        SELECT
          RTRIM(LTRIM(CAST(re.PRODUTO AS VARCHAR(50)))) AS produtoKey,
          re.primeiraEntrada
        FROM recent_entries re
        WHERE NOT EXISTS (
          SELECT 1
          FROM ESTOQUE_PROD_ENT e2 WITH (NOLOCK)
          JOIN ESTOQUE_PROD1_ENT pe2 WITH (NOLOCK)
            ON pe2.ROMANEIO_PRODUTO = e2.ROMANEIO_PRODUTO
          WHERE pe2.PRODUTO = re.PRODUTO
            AND e2.EMISSAO < DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
        )
        AND NOT EXISTS (
          SELECT 1
          FROM LOJA_ENTRADAS le2 WITH (NOLOCK)
          JOIN LOJA_ENTRADAS_PRODUTO lep2 WITH (NOLOCK)
            ON le2.FILIAL = lep2.FILIAL AND le2.ROMANEIO_PRODUTO = lep2.ROMANEIO_PRODUTO
          WHERE lep2.PRODUTO = re.PRODUTO
            AND le2.EMISSAO < DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
            AND (le2.ENTRADA_CANCELADA = 0 OR le2.ENTRADA_CANCELADA IS NULL)
        )
      ),
      base_produtos AS (
        SELECT
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS produto,
          RTRIM(LTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS descricao,
          ISNULL(p.LINHA, '') AS linha,
          p.DATA_CADASTRAMENTO AS dataCadastro,
          ne.primeiraEntrada AS primeiraEntrada,
          CASE
            WHEN p.DATA_CADASTRAMENTO IS NOT NULL
              AND p.DATA_CADASTRAMENTO >= DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
            THEN 1 ELSE 0
          END AS byCadastro,
          CASE WHEN ne.produtoKey IS NOT NULL THEN 1 ELSE 0 END AS byEntrada
        FROM PRODUTOS p WITH (NOLOCK)
        LEFT JOIN novos_entrada ne
          ON ne.produtoKey = RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50))))
        WHERE 1 = 1
          ${companyScopeFilter}
          AND (
            (
              p.DATA_CADASTRAMENTO IS NOT NULL
              AND p.DATA_CADASTRAMENTO >= DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
            )
            OR ne.produtoKey IS NOT NULL
          )
      )
      SELECT
        bp.produto,
        bp.descricao,
        ISNULL(color_source.corCodigo, '') AS corCodigo,
        ISNULL(c.DESC_COR, '') AS cor,
        bp.linha,
        CONVERT(VARCHAR(19), bp.dataCadastro, 120) AS dataCadastro,
        CONVERT(VARCHAR(19), bp.primeiraEntrada, 120) AS primeiraEntrada,
        bp.byCadastro,
        bp.byEntrada
      FROM base_produtos bp
      OUTER APPLY (
        SELECT DISTINCT src.corCodigo
        FROM (
          SELECT RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) = bp.produto
            AND pb.COR_PRODUTO IS NOT NULL
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

          UNION

          SELECT RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
          FROM PRODUTO_CORES pc WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(pc.PRODUTO AS VARCHAR(50)))) = bp.produto
            AND pc.COR_PRODUTO IS NOT NULL
            AND RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) <> ''
        ) src

        UNION ALL

        SELECT ''
        WHERE NOT EXISTS (
          SELECT 1
          FROM (
            SELECT RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            WHERE RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) = bp.produto
              AND pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            SELECT RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
            FROM PRODUTO_CORES pc WITH (NOLOCK)
            WHERE RTRIM(LTRIM(CAST(pc.PRODUTO AS VARCHAR(50)))) = bp.produto
              AND pc.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) <> ''
          ) fallback_cores
        )
      ) color_source
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(bp.produto))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(color_source.corCodigo AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, color_source.corCodigo))
      ORDER BY
        CASE WHEN bp.primeiraEntrada > bp.dataCadastro OR bp.dataCadastro IS NULL THEN bp.primeiraEntrada ELSE bp.dataCadastro END DESC,
        bp.produto ASC,
        color_source.corCodigo ASC
    `;

    const result = await request.query<ProdutoNovoRow>(query);

    return result.recordset
      .map((row): ProdutoNovoItem => {
        const byCadastro = Number(row.byCadastro ?? 0) === 1;
        const byEntrada = Number(row.byEntrada ?? 0) === 1;
        const dataCadastro = row.dataCadastro ? String(row.dataCadastro) : null;
        const primeiraEntrada = row.primeiraEntrada ? String(row.primeiraEntrada) : null;

        // surgeDate = menor sinal que qualificou o produto como novo.
        const candidateTimes: Array<{ iso: string; t: number }> = [];
        if (byCadastro && dataCadastro) {
          const t = parseSqlDate(dataCadastro);
          if (t != null) candidateTimes.push({ iso: dataCadastro, t });
        }
        if (byEntrada && primeiraEntrada) {
          const t = parseSqlDate(primeiraEntrada);
          if (t != null) candidateTimes.push({ iso: primeiraEntrada, t });
        }
        const surge = candidateTimes.sort((a, b) => a.t - b.t)[0] ?? null;

        const origem: ProdutoNovoOrigem =
          byCadastro && byEntrada ? "ambos" : byEntrada ? "entrada" : "cadastro";

        return {
          produto: String(row.produto ?? "").trim(),
          descricao: String(row.descricao ?? "").trim(),
          corCodigo: String(row.corCodigo ?? "").trim(),
          cor: String(row.cor ?? "").trim() || "-",
          linha: String(row.linha ?? "").trim() || null,
          dataCadastro,
          primeiraEntrada,
          surgeDate: surge?.iso ?? dataCadastro ?? primeiraEntrada ?? null,
          origem,
          vendas: 0,
          qtde: 0,
        };
      })
      .filter((row) => !(company === "scarfme" && (row.linha ?? "").toUpperCase() === "ELETRONICOS"));
  });

  return attachSalesPerformance(company, items);
}

/**
 * Anexa a performance de vendas de cada produto novo "desde que surgiu" usando a
 * função canônica de vendas (com trocas). Como todo item da lista surgiu dentro da
 * janela e — no caso de novo-por-entrada — não teve nenhuma entrada anterior à
 * janela, ele não pôde vender antes de surgir; logo a venda na janela equivale à
 * venda desde o surgimento.
 */
async function attachSalesPerformance(
  company: CompanyKey,
  items: ProdutoNovoItem[]
): Promise<ProdutoNovoItem[]> {
  if (items.length === 0) return items;

  const companyLive = await resolveCompanyLive(company);
  if (!companyLive) return items;

  const ecommerceFilials = companyLive.ecommerceFilials ?? [];
  const ecomSet = new Set(ecommerceFilials);
  const posFilials = (companyLive.filialFilters?.sales ?? []).filter((f) => !ecomSet.has(f));

  const produtoIds = Array.from(new Set(items.map((i) => i.produto).filter(Boolean)));
  if (produtoIds.length === 0) return items;

  const now = new Date();
  const windowStart = new Date(now.getTime() - PRODUTOS_NOVOS_WINDOW_DAYS * DAY_IN_MS);
  const range = normalizeRangeForQuery({ start: windowStart, end: now });

  let salesRows: Awaited<ReturnType<typeof fetchFilialProdutoSales>> = [];
  try {
    salesRows = await fetchFilialProdutoSales(company, posFilials, ecommerceFilials, range, "month", {
      groupByCor: true,
      includePrevious: false,
      limit: 0,
      produtoIds,
    });
  } catch (error) {
    console.error("Erro ao carregar performance de produtos novos (não-fatal)", error);
    return items;
  }

  const salesByCor = new Map<string, { vendas: number; qtde: number }>();
  for (const r of salesRows) {
    const produto = (r.produto ?? "").trim();
    const cor = (r.cor ?? "").trim();
    if (!produto) continue;
    for (const key of corLookupKeys(produto, cor)) {
      const acc = salesByCor.get(key) ?? { vendas: 0, qtde: 0 };
      acc.vendas += Number(r.vendas ?? 0);
      acc.qtde += Number(r.qtde ?? 0);
      salesByCor.set(key, acc);
    }
  }

  return items.map((item) => {
    let perf: { vendas: number; qtde: number } | undefined;
    for (const key of corLookupKeys(item.produto, item.corCodigo)) {
      perf = salesByCor.get(key);
      if (perf) break;
    }
    return perf ? { ...item, vendas: perf.vendas, qtde: perf.qtde } : item;
  });
}

export async function syncProdutoNovoLabels(company: CompanyKey): Promise<{
  total: number;
  inserted: number;
  removed: number;
  produtos: ProdutoNovoItem[];
}> {
  const produtos = await fetchProdutosNovosRecentes(company);

  const syncResult = await syncProdutoLabelSet(
    company,
    PRODUTO_NOVO_LABEL,
    produtos.map((item) => ({
      produto: item.produto,
      cor: item.corCodigo,
    }))
  );

  return {
    ...syncResult,
    produtos,
  };
}

export async function fetchProdutosNovosPageData(company: CompanyKey): Promise<ProdutoNovoItem[]> {
  const result = await syncProdutoNovoLabels(company);
  return result.produtos;
}
