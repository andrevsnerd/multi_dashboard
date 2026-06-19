import { fetchProductsWithDetails } from "@/lib/repositories/products";
import {
  fetchMultipleProductsStockByColorPorFilial,
  type FilialStockBreakdown,
} from "@/lib/repositories/inventory";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
} from "@/lib/config/company";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Prefixo das chaves das colunas dinâmicas de estoque por filial. */
const FILIAL_COL_PREFIX = "ESTOQUE_FILIAL::";

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

  const total = filtered.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? filtered.slice(0, limit) : filtered;

  // Estoque por filial (opcional). Gera uma coluna por filial (rede inteira, SEMPRE —
  // independente do filtro de filial das vendas) + um ESTOQUE_TOTAL coerente com a soma.
  // Por filial: pos>0?pos:neg (mesma regra de visualização). Total da rede: (Σpos)>0?Σpos:Σneg.
  let dynamicColumns: ReportColumnDef[] | undefined;
  const estoquePorFilialByKey = new Map<
    string,
    { total: number; porLabel: Map<string, number> }
  >();

  if (filters.estoquePorFilial && sliced.length > 0) {
    const company = await resolveCompanyLive(filters.company);
    const pairs = sliced.map((d) => ({
      productId: String(d.productId ?? "").trim(),
      corProduto: d.corProduto ?? null,
    }));
    const breakdown: Map<string, Map<string, FilialStockBreakdown>> =
      await fetchMultipleProductsStockByColorPorFilial(pairs, {
        company: filters.company,
        filial: null, // sempre a rede inteira ("onde o produto está")
      }).catch(() => new Map<string, Map<string, FilialStockBreakdown>>());

    const labelSet = new Set<string>();
    if (company) {
      for (const f of getOperationalFilials(company, "inventory")) {
        labelSet.add(getFilialLabelForDisplay(company, f));
      }
    }

    for (const d of sliced) {
      const pid = String(d.productId ?? "").trim();
      const cor = d.corProduto ? String(d.corProduto).trim() : null;
      const key = cor ? `${pid}-${cor}` : `${pid}-null`;
      const byFilial = breakdown.get(key);
      const porLabel = new Map<string, number>();
      let sumPos = 0;
      let sumNeg = 0;
      if (byFilial) {
        const posByLabel = new Map<string, number>();
        const negByLabel = new Map<string, number>();
        byFilial.forEach((b) => {
          const label = company ? getFilialLabelForDisplay(company, b.filial) : b.filial;
          labelSet.add(label);
          posByLabel.set(label, (posByLabel.get(label) ?? 0) + b.positiveStock);
          negByLabel.set(label, (negByLabel.get(label) ?? 0) + b.negativeStock);
        });
        posByLabel.forEach((pos, label) => {
          const neg = negByLabel.get(label) ?? 0;
          porLabel.set(label, pos > 0 ? pos : neg);
          sumPos += pos;
          sumNeg += neg;
        });
      }
      estoquePorFilialByKey.set(key, {
        total: sumPos > 0 ? sumPos : sumNeg,
        porLabel,
      });
    }

    const orderedLabels = Array.from(labelSet).sort((a, b) =>
      company ? compareFilialDisplayOrder(a, b, company) : a.localeCompare(b, "pt-BR")
    );
    dynamicColumns = orderedLabels.map((label) => ({
      key: `${FILIAL_COL_PREFIX}${label}`,
      defaultLabel: label,
      type: "int" as const,
    }));
  }

  let acumPerc = 0;
  const rows: ReportRow[] = sliced.map((d) => {
    const qty = d.totalQuantity ?? 0;
    const custoUnit = d.cost ?? 0;
    const custoTotal = custoUnit * qty;
    const revenue = d.totalRevenue ?? 0;
    const margem = revenue - custoTotal;
    const partPerc = sumRevenue !== 0 ? (revenue / sumRevenue) * 100 : 0;
    acumPerc += partPerc;

    const pid = String(d.productId ?? "").trim();
    const corKey = d.corProduto ? String(d.corProduto).trim() : null;
    const rowKey = corKey ? `${pid}-${corKey}` : `${pid}-null`;

    // Curva ABC pela mesma regra da tela de Curva ABC: faturamento acumulado
    // (já ordenado desc) ≤60% → A, ≤90% → B, senão C.
    const curva = acumPerc <= 60 ? "A" : acumPerc <= 90 ? "B" : "C";

    const row: ReportRow = {
      CURVA: curva,
      PRODUTO: pid,
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

    if (filters.estoquePorFilial) {
      const est = estoquePorFilialByKey.get(rowKey);
      row.ESTOQUE_TOTAL = roundInt(est?.total ?? 0);
      for (const col of dynamicColumns ?? []) {
        row[col.key] = roundInt(est?.porLabel.get(col.defaultLabel) ?? 0);
      }
    }

    return row;
  });

  // KPIs sempre coerentes com o que está na tabela (refletem todos os filtros,
  // inclusive cor/tipo). Ticket Médio = Vendas Total ÷ nº de vendas (tickets).
  const tickets = salesTotals?.tickets ?? 0;
  const ticketMedio = tickets > 0 ? sumRevenue / tickets : 0;
  const summary: ReportSummaryMetric[] = [
    { label: "Vendas Total", value: round2(sumRevenue), format: "currency" },
    { label: "Produtos Vendidos", value: roundInt(sumQuantity), format: "int" },
    { label: "Ticket Médio", value: round2(ticketMedio), format: "currency" },
  ];

  return { rows, total, truncated, summary, dynamicColumns };
}
