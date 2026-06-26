import { fetchProductsWithDetails, fetchProdutosCustoPrecoMestre } from "@/lib/repositories/products";
import {
  fetchMultipleProductsStockByColorPorFilial,
  type FilialStockBreakdown,
} from "@/lib/repositories/inventory";
import { fetchProdutoQtdePorFilial } from "@/lib/repositories/performance";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
  type CompanyKey,
} from "@/lib/config/company";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { canonicalKey, ROW_COR_FIELD } from "@/lib/reports/keys";
import { getControleEstoqueMetricasItens } from "@/lib/server/controle-estoque-metricas";
import { buildControleEstoqueItemKey } from "@/lib/utils/controle-estoque-metricas";
import { calcCompraIdealFromResumo } from "@/lib/utils/compra-ideal";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";
import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Limite de linhas quando a Compra Ideal está ligada (cálculo por item é caro). */
const COMPRA_IDEAL_LIMIT = 1000;

/** Índice de compras em trânsito ativas por (produto × cor canônica). */
async function buildTransitIndex(
  company: string | undefined
): Promise<Map<string, CompraTransitoIndexEntry[]>> {
  const idx = new Map<string, CompraTransitoIndexEntry[]>();
  if (!company) return idx;
  const compras = await listComprasTransitoFull(company).catch(() => []);
  const today = new Date();
  for (const c of compras) {
    for (const it of c.items ?? []) {
      if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
      const k = canonicalKey(it.produto, it.corProduto ?? null);
      const arr = idx.get(k) ?? [];
      arr.push({
        itemKey: it.itemKey ?? "",
        produto: it.produto,
        corProduto: it.corProduto ?? null,
        quantidade: Number(it.quantidade ?? 0),
        dataRecebimento: it.dataRecebimento,
        title: c.title ?? "",
        confirmedAt: c.confirmedAt ?? "",
      });
    }
  }
  return idx;
}

/** Prefixo das chaves das colunas dinâmicas de estoque por filial. */
const FILIAL_COL_PREFIX = "ESTOQUE_FILIAL::";

/** Prefixo das chaves das colunas dinâmicas de venda (faturamento) por filial. */
const VENDA_FILIAL_COL_PREFIX = "VENDA_FILIAL::";

/** Prefixo das chaves das colunas dinâmicas de quantidade vendida por filial. */
const QTD_FILIAL_COL_PREFIX = "QTD_FILIAL::";

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
  const baseLimit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  // Compra Ideal calcula métricas por item (caro) → limita as linhas quando ligada.
  const limit = filters.compraIdeal ? Math.min(baseLimit, COMPRA_IDEAL_LIMIT) : baseLimit;
  const truncated = total > limit;
  const sliced = truncated ? filtered.slice(0, limit) : filtered;

  // Custo unitário e preço sugerido SEMPRE da tabela mestre PRODUTOS (CUSTO_REPOSICAO1 /
  // PRECO_REPOSICAO_1) — o custo atual, não o custo da época da venda (esse só aparece na
  // análise "Histórico de vendas", coluna CUSTO_UNIT_HISTORICO). Custo total, margem e
  // markup são derivados desse custo atualizado. Valor por PRODUTO (custo é atributo de
  // cadastro, não da cor).
  const custoPrecoMestre = await fetchProdutosCustoPrecoMestre(
    sliced.map((d) => String(d.productId ?? "").trim())
  );

  // Compra Ideal por produto (mesma lógica de Lista Loja / Curva ABC): métricas de
  // ritmo por item + compras em trânsito → calcCompraIdealFromResumo.
  let compraIdealByItemKey: Map<string, number> | null = null;
  if (filters.compraIdeal && sliced.length > 0) {
    const itens = sliced.map((d) => ({
      produto: String(d.productId ?? "").trim(),
      corProduto: d.corProduto ?? null,
    }));
    const [metricas, transitIndex] = await Promise.all([
      getControleEstoqueMetricasItens({
        company: filters.company,
        filial: filters.filial ?? null,
        itens,
      }),
      buildTransitIndex(filters.company),
    ]);
    compraIdealByItemKey = new Map();
    for (const d of sliced) {
      const itemKey = buildControleEstoqueItemKey(d.productId, d.corProduto);
      const m = metricas[itemKey];
      if (!m) continue;
      const transit = transitIndex.get(canonicalKey(d.productId, d.corProduto)) ?? [];
      const ideal = calcCompraIdealFromResumo(m.resumo, transit, {
        linha: d.linha,
        subgrupo: d.subgrupo,
        company: filters.company,
      });
      compraIdealByItemKey.set(itemKey, ideal.compraIdeal);
    }
  }

  // Estoque e/ou venda por filial (opcional). Gera colunas por filial (rede inteira,
  // SEMPRE — independente do filtro de filial das vendas). Quando ambos estão ligados,
  // as colunas vêm INTERCALADAS por filial: "{filial} Venda", "{filial} Estoque".
  // Estoque por filial: pos>0?pos:neg (regra de visualização). Total da rede: (Σpos)>0?Σpos:Σneg.
  // Venda por filial: qtde líquida vendida no período (mesma fonte da Curva ABC / visão geral).
  let dynamicColumns: ReportColumnDef[] | undefined;
  const estoquePorFilialByKey = new Map<
    string,
    { total: number; porLabel: Map<string, number> }
  >();
  // Por filial: faturamento (valor) e quantidade vendida, separados.
  const vendaFatPorFilialByKey = new Map<string, Map<string, number>>();
  const vendaQtdPorFilialByKey = new Map<string, Map<string, number>>();
  const wantsFilialBreakdown = filters.estoquePorFilial || filters.vendasPorFilial;

  if (wantsFilialBreakdown && sliced.length > 0) {
    const company = await resolveCompanyLive(filters.company);
    const labelSet = new Set<string>();
    if (company) {
      for (const f of getOperationalFilials(company, "inventory")) {
        labelSet.add(getFilialLabelForDisplay(company, f));
      }
    }

    // ── Estoque por filial ────────────────────────────────────────────────────
    if (filters.estoquePorFilial) {
      const pairs = sliced.map((d) => ({
        productId: String(d.productId ?? "").trim(),
        corProduto: d.corProduto ?? null,
      }));
      const breakdown: Map<string, Map<string, FilialStockBreakdown>> =
        await fetchMultipleProductsStockByColorPorFilial(pairs, {
          company: filters.company,
          filial: null, // sempre a rede inteira ("onde o produto está")
        }).catch(() => new Map<string, Map<string, FilialStockBreakdown>>());

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
    }

    // ── Venda (qtde) por filial ───────────────────────────────────────────────
    if (filters.vendasPorFilial && company) {
      const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
      const salesFiliais = company.filialFilters.sales ?? [];
      const posNames = salesFiliais.filter((f) => !ecommerceFilials.has(f));
      const ecomNames = salesFiliais.filter((f) => ecommerceFilials.has(f));
      const range = normalizeRangeForQuery({ start: filters.start, end: filters.end });

      const qtdeRows = await fetchProdutoQtdePorFilial(
        (filters.company ?? "") as CompanyKey,
        posNames,
        ecomNames,
        range,
        { groupByCor: true }
      ).catch(() => []);

      // Indexa por produto×cor canônica → label → {fat, qtde} (somando rótulos que se
      // repetem, ex.: e-commerce / grupos de filial → mesmo label de exibição).
      const fatByCanonical = new Map<string, Map<string, number>>();
      const qtdByCanonical = new Map<string, Map<string, number>>();
      for (const r of qtdeRows) {
        const label = getFilialLabelForDisplay(company, r.filial);
        if (!label) continue;
        labelSet.add(label);
        const k = canonicalKey(r.produto, r.cor || null);
        let fatLabel = fatByCanonical.get(k);
        if (!fatLabel) {
          fatLabel = new Map<string, number>();
          fatByCanonical.set(k, fatLabel);
        }
        fatLabel.set(label, (fatLabel.get(label) ?? 0) + Number(r.vendas ?? 0));
        let qtdLabel = qtdByCanonical.get(k);
        if (!qtdLabel) {
          qtdLabel = new Map<string, number>();
          qtdByCanonical.set(k, qtdLabel);
        }
        qtdLabel.set(label, (qtdLabel.get(label) ?? 0) + Number(r.qtde ?? 0));
      }

      for (const d of sliced) {
        const pid = String(d.productId ?? "").trim();
        const cor = d.corProduto ? String(d.corProduto).trim() : null;
        const key = cor ? `${pid}-${cor}` : `${pid}-null`;
        const ck = canonicalKey(pid, cor);
        vendaFatPorFilialByKey.set(key, fatByCanonical.get(ck) ?? new Map());
        vendaQtdPorFilialByKey.set(key, qtdByCanonical.get(ck) ?? new Map());
      }
    }

    const orderedLabels = Array.from(labelSet).sort((a, b) =>
      company ? compareFilialDisplayOrder(a, b, company) : a.localeCompare(b, "pt-BR")
    );

    // Por filial, na ordem: "{filial} Venda" (faturamento), "{filial} Qtd" (quantidade),
    // "{filial} Estoque". Quando só estoque está ligado, a coluna mantém só o nome da filial.
    dynamicColumns = orderedLabels.flatMap((label) => {
      const cols: ReportColumnDef[] = [];
      if (filters.vendasPorFilial) {
        cols.push({
          key: `${VENDA_FILIAL_COL_PREFIX}${label}`,
          defaultLabel: `${label} Venda`,
          type: "currency" as const,
        });
        cols.push({
          key: `${QTD_FILIAL_COL_PREFIX}${label}`,
          defaultLabel: `${label} Qtd`,
          type: "int" as const,
        });
      }
      if (filters.estoquePorFilial) {
        cols.push({
          key: `${FILIAL_COL_PREFIX}${label}`,
          defaultLabel: filters.vendasPorFilial ? `${label} Estoque` : label,
          type: "int" as const,
        });
      }
      return cols;
    });
  }

  // Projeção/duração: ritmo diário medido no período selecionado, projetado para o
  // mês corrente. Projeção qtd mês = ritmo × dias do mês; Estoque final mês = estoque −
  // ritmo × dias restantes do mês; Duração = estoque ÷ ritmo (dias). Tudo barato (sem query).
  const { start: pStart, end: pEnd } = normalizeRangeForQuery({ start: filters.start, end: filters.end });
  const diasPeriodo = Math.max(1, Math.round((pEnd.getTime() - pStart.getTime()) / 86400000));
  const hoje = new Date();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const diasRestantesMes = Math.max(0, diasNoMes - hoje.getDate());

  let acumPerc = 0;
  const rows: ReportRow[] = sliced.map((d) => {
    const qty = d.totalQuantity ?? 0;
    const pid = String(d.productId ?? "").trim();
    // Custo atualizado do mestre; cai no custo de venda só se o cadastro não tiver custo.
    const mestre = custoPrecoMestre.get(pid);
    const custoUnit = mestre && mestre.custo > 0 ? mestre.custo : (d.cost ?? 0);
    const custoTotal = custoUnit * qty;
    const revenue = d.totalRevenue ?? 0;
    const margem = revenue - custoTotal;
    const avgPrice = d.averagePrice ?? 0;
    const markup = custoUnit > 0 ? avgPrice / custoUnit : 0;
    const precoSugerido =
      mestre && mestre.precoSugerido != null
        ? mestre.precoSugerido
        : d.suggestedPrice != null
          ? d.suggestedPrice
          : null;
    const partPerc = sumRevenue !== 0 ? (revenue / sumRevenue) * 100 : 0;
    acumPerc += partPerc;
    const corKey = d.corProduto ? String(d.corProduto).trim() : null;
    const rowKey = corKey ? `${pid}-${corKey}` : `${pid}-null`;

    // Curva ABC pela mesma regra da tela de Curva ABC: faturamento acumulado
    // (já ordenado desc) ≤60% → A, ≤90% → B, senão C.
    const curva = acumPerc <= 60 ? "A" : acumPerc <= 90 ? "B" : "C";

    const row: ReportRow = {
      [ROW_COR_FIELD]: corKey ?? "", // código cru da cor (join entre análises)
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
      PROJECAO_QTD_MES: roundInt((qty / diasPeriodo) * diasNoMes),
      ESTOQUE_FINAL_MES: roundInt((d.stock ?? 0) - (qty / diasPeriodo) * diasRestantesMes),
      DURACAO_ESTOQUE:
        qty > 0 ? roundInt((d.stock ?? 0) / (qty / diasPeriodo)) : (d.stock ?? 0) > 0 ? 999 : 0,
      FATURAMENTO: round2(revenue),
      TICKET_MEDIO: round2(d.averagePrice),
      CUSTO_UNITARIO: round2(custoUnit),
      CUSTO_TOTAL: round2(custoTotal),
      MARKUP: round2(markup),
      MARGEM: round2(margem),
      MARGEM_PERC: revenue !== 0 ? round2((margem / revenue) * 100) : 0,
      ESTOQUE: roundInt(d.stock),
      PRECO_SUGERIDO: precoSugerido != null ? round2(precoSugerido) : null,
      PARTICIPACAO_PERC: round2(partPerc),
      PARTICIPACAO_ACUM_PERC: round2(acumPerc),
    };

    if (filters.compraIdeal) {
      const ci = compraIdealByItemKey?.get(buildControleEstoqueItemKey(d.productId, d.corProduto));
      row.COMPRA_IDEAL = ci == null ? null : roundInt(ci);
    }

    if (filters.estoquePorFilial) {
      row.ESTOQUE_TOTAL = roundInt(estoquePorFilialByKey.get(rowKey)?.total ?? 0);
    }
    if (wantsFilialBreakdown) {
      const estPorLabel = estoquePorFilialByKey.get(rowKey)?.porLabel;
      const fatPorLabel = vendaFatPorFilialByKey.get(rowKey);
      const qtdPorLabel = vendaQtdPorFilialByKey.get(rowKey);
      for (const col of dynamicColumns ?? []) {
        if (col.key.startsWith(VENDA_FILIAL_COL_PREFIX)) {
          const label = col.key.slice(VENDA_FILIAL_COL_PREFIX.length);
          row[col.key] = round2(fatPorLabel?.get(label) ?? 0);
        } else if (col.key.startsWith(QTD_FILIAL_COL_PREFIX)) {
          const label = col.key.slice(QTD_FILIAL_COL_PREFIX.length);
          row[col.key] = roundInt(qtdPorLabel?.get(label) ?? 0);
        } else if (col.key.startsWith(FILIAL_COL_PREFIX)) {
          const label = col.key.slice(FILIAL_COL_PREFIX.length);
          row[col.key] = roundInt(estPorLabel?.get(label) ?? 0);
        }
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

  await applyColecaoLabels(filters.company, rows);

  return { rows, total, truncated, summary, dynamicColumns };
}
