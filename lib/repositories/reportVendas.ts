import { fetchProductsWithDetails } from "@/lib/repositories/products";
import type { ReportFilters, ReportResult, ReportRow } from "@/lib/reports/types";

/** Limite alto por padrão; a página pode reduzir. Sinaliza `truncated` se exceder. */
const DEFAULT_LIMIT = 5000;

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** Conjunto normalizado (UPPER/trim) para match de filtros pós-consulta; null = sem filtro. */
function normalizeSet(values: string[] | null | undefined): Set<string> | null {
  const list = (values ?? []).map(up).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Análise "Vendas por faturamento" (por produto × cor).
 *
 * Reusa a lógica VALIDADA da tela de Produtos (`fetchProductsWithDetails` com
 * `groupByColor: true`): trocas, cancelamentos, descontos, fator de venda e
 * grupos de filial já estão tratados ali. Aqui só aplicamos os filtros que
 * aquela função não expõe (cor por descrição e tipo), ordenamos por faturamento
 * e calculamos participação/margem.
 */
export async function fetchVendasFaturamento(
  filters: ReportFilters
): Promise<ReportResult> {
  const details = await fetchProductsWithDetails({
    company: filters.company,
    range: { start: filters.start, end: filters.end },
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    groupByColor: true,
    produtoId: filters.produtoId ?? undefined,
    produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
  });

  // Filtros pós-consulta. Cor é casada pela DESCRIÇÃO (ex.: "PRETO"), que é o que
  // /api/products/cores devolve — evita o problema de código '06' vs '6'.
  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);

  const filtered = details.filter((d) => {
    if (corSet && !corSet.has(up(d.descCorProduto))) return false;
    if (tipoSet && !tipoSet.has(up(d.tipo))) return false;
    return true;
  });

  filtered.sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Denominador da participação = faturamento total do conjunto filtrado.
  const sumRevenue = filtered.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);

  const total = filtered.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? filtered.slice(0, limit) : filtered;

  let acumPerc = 0;
  const rows: ReportRow[] = sliced.map((d) => {
    const qty = d.totalQuantity ?? 0;
    const custoUnit = d.cost ?? 0;
    const custoTotal = custoUnit * qty;
    const revenue = d.totalRevenue ?? 0;
    const margem = revenue - custoTotal;
    const partPerc = sumRevenue !== 0 ? (revenue / sumRevenue) * 100 : 0;
    acumPerc += partPerc;

    return {
      PRODUTO: String(d.productId ?? "").trim(),
      COR: d.corProduto ? String(d.corProduto).trim() : "",
      COR_DESCRICAO: d.descCorProduto ?? "",
      DESCRICAO: d.productName ?? "",
      GRUPO: d.grupo ?? "",
      SUBGRUPO: d.subgrupo ?? "",
      LINHA: d.linha ?? "",
      TIPO: d.tipo ?? "",
      GRADE: d.grade ?? "",
      QTDE: roundInt(qty),
      FATURAMENTO: round2(revenue),
      TICKET_MEDIO: round2(d.averagePrice),
      CUSTO_UNITARIO: round2(custoUnit),
      CUSTO_TOTAL: round2(custoTotal),
      MARKUP: round2(d.markup),
      MARGEM: round2(margem),
      MARGEM_PERC: revenue !== 0 ? round2((margem / revenue) * 100) : 0,
      ESTOQUE: roundInt(d.stock),
      PRECO_SUGERIDO: d.suggestedPrice != null ? round2(d.suggestedPrice) : null,
      PARTICIPACAO_PERC: round2(partPerc),
      PARTICIPACAO_ACUM_PERC: round2(acumPerc),
    };
  });

  return { rows, total, truncated };
}
