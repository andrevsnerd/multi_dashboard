import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import type { ReportFilters, ReportResult, ReportRow, ReportSummaryMetric } from "@/lib/reports/types";

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
  const salesFilters = {
    company: filters.company,
    range: { start: filters.start, end: filters.end },
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    produtoId: filters.produtoId ?? undefined,
    produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
  };

  // Contagem de vendas (tickets) vem da fonte canônica fetchSalesTotals, agora
  // ciente de TODOS os filtros (inclui cor/tipo) — necessária só para o Ticket
  // Médio. Vendas Total / Produtos Vendidos / Estoque Total são derivados das
  // próprias linhas filtradas (batem exatamente com a tabela, com qualquer filtro).
  const [details, salesTotals] = await Promise.all([
    fetchProductsWithDetails({ ...salesFilters, groupByColor: true }),
    fetchSalesTotals({
      company: filters.company,
      range: normalizeRangeForQuery({ start: filters.start, end: filters.end }),
      filial: filters.filial ?? null,
      linhas: filters.linhas ?? null,
      grupos: filters.grupos ?? null,
      subgrupos: filters.subgrupos ?? null,
      grades: filters.grades ?? null,
      colecoes: filters.colecoes ?? null,
      cores: filters.cores ?? null,
      tipos: filters.tipos ?? null,
      produtoId: filters.produtoId ?? null,
      produtoSearchTerm: filters.produtoSearchTerm ?? null,
    }).catch(() => null),
  ]);

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

  // Totais do conjunto filtrado (servem para participação E para os KPIs).
  const sumRevenue = filtered.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
  const sumQuantity = filtered.reduce((s, d) => s + (d.totalQuantity ?? 0), 0);
  const sumStock = filtered.reduce((s, d) => s + (d.stock ?? 0), 0);

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

  // KPIs sempre coerentes com o que está na tabela (refletem todos os filtros,
  // inclusive cor/tipo). Ticket Médio = Vendas Total ÷ nº de vendas (tickets).
  const tickets = salesTotals?.tickets ?? 0;
  const ticketMedio = tickets > 0 ? sumRevenue / tickets : 0;
  const summary: ReportSummaryMetric[] = [
    { label: "Vendas Total", value: round2(sumRevenue), format: "currency" },
    { label: "Produtos Vendidos", value: roundInt(sumQuantity), format: "int" },
    { label: "Ticket Médio", value: round2(ticketMedio), format: "currency" },
    { label: "Estoque Total", value: roundInt(sumStock), format: "int" },
  ];

  return { rows, total, truncated, summary };
}
