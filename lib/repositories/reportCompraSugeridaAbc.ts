import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
} from "@/lib/config/company";
import { canonicalKey, ROW_COR_FIELD } from "@/lib/reports/keys";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import { getControleEstoqueMetricasItensBatched } from "@/lib/server/controle-estoque-metricas";
import { buildControleEstoqueItemKey } from "@/lib/utils/controle-estoque-metricas";
import {
  calcCompraIdealFromResumo,
  precisaComprarEssaSemana,
} from "@/lib/utils/compra-ideal";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";
import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import { COMPRA_FILIAL_COL_PREFIX } from "@/lib/reports/compra-sugerida-abc";
import { fetchControleTransferencias } from "@/lib/repositories/controleTransferencias";
import {
  buildTransferLensIndex,
  resolveTransferLens,
  applyTransferLens,
  type TransferLensIndex,
} from "@/lib/utils/transferencia-regras";
import type { CompanyKey } from "@/lib/config/company";
import type { ReportRunContext } from "@/lib/reports/registry.server";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/**
 * Teto de itens da curva considerados. O cálculo de Compra Ideal por loja roda métricas
 * de ritmo/estoque por item × loja (caro), então limitamos aos itens de maior faturamento
 * (os relevantes da Curva ABC). O resto é cauda C, que dificilmente entra em "comprar agora".
 */
const ITEM_LIMIT = 1500;

/** Quantas lojas calcular em paralelo (cada uma já batcheia os itens internamente). */
const FILIAL_CONCURRENCY = 3;

/**
 * Alias por DESCRIÇÃO de cor (espelha lib/client/compras-transito): casa quando o
 * código de cor gravado no trânsito difere do código de estoque/curva mas representa
 * a MESMA cor (ex.: '86' x '120' = AZUL/VERDE), quando o trânsito veio sem código,
 * ou quando gravaram a descrição no lugar do código. Prefixo dedicado para nunca
 * colidir com a chave canônica.
 */
const TRANSIT_DESC_PREFIX = " desc ";

function transitDescKey(
  produto: string | null | undefined,
  corProduto: string | null | undefined,
  corDescricao?: string | null
): string | null {
  // A descrição de cor é escopada POR PRODUTO no Linx (o mesmo código descreve
  // cores diferentes por produto). Prioriza a descrição do cadastro do item
  // (corDescricao = PRODUTO_CORES.DESC_COR_PRODUTO / descCorProduto do detalhe);
  // getMappedColorDescription (mapa global) entra só como fallback quando vazia.
  const doProduto = (corDescricao ?? "").trim();
  const base = doProduto || getMappedColorDescription(corProduto);
  const raw = base.trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!raw) return null;
  return `${TRANSIT_DESC_PREFIX}${String(produto ?? "").trim()}||${raw}`;
}

/** Índice de compras em trânsito ativas por (produto × cor canônica) — abatido como pool da rede. */
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
      const entry: CompraTransitoIndexEntry = {
        itemKey: it.itemKey ?? "",
        produto: it.produto,
        corProduto: it.corProduto ?? null,
        quantidade: Number(it.quantidade ?? 0),
        dataRecebimento: it.dataRecebimento,
        title: c.title ?? "",
        confirmedAt: c.confirmedAt ?? "",
      };
      const k = canonicalKey(it.produto, it.corProduto ?? null);
      idx.set(k, [...(idx.get(k) ?? []), entry]);
      const dk = transitDescKey(it.produto, it.corProduto, it.corDescricao);
      if (dk) idx.set(dk, [...(idx.get(dk) ?? []), entry]);
    }
  }
  return idx;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

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
 * Análise "Compra sugerida por Curva ABC" — lista de compras consolidada da rede.
 *
 * Universo = itens vendidos na rede no período (produto × cor), ordenados por faturamento
 * (Curva ABC). Para cada item, calcula a Compra Ideal de CADA loja com a MESMA fonte e
 * regra da Lista Loja / Curva ABC (resumo de métricas com escopo na filial + trânsito da
 * rede abatido como pool → `calcCompraIdealFromResumo`). A quantidade da loja só entra
 * quando aquela loja precisa "comprar agora" (data de compra já chegou) OU "comprar essa
 * semana" (data cai antes do próximo dia de compra) — espelha o filtro "Comprar agora"
 * da Curva ABC / Lista Loja. Itens que nenhuma loja precisa comprar agora ficam de fora.
 *
 * As colunas por loja são dinâmicas (`COMPRA_FILIAL::{loja}`). Compra total e Custo total
 * são preenchidos com o valor estático aqui (tabela web) e viram FÓRMULAS no XLSX dedicado.
 */
export async function fetchCompraSugeridaAbc(
  filters: ReportFilters,
  ctx?: ReportRunContext
): Promise<ReportResult> {
  const details = await fetchProductsWithDetails({
    company: filters.company,
    range: { start: filters.start, end: filters.end },
    filial: null, // sempre a rede inteira — uma coluna por loja
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    produtoId: filters.produtoId ?? undefined,
    produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
    groupByColor: true,
  });

  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);
  const filtered = details.filter((d) => {
    if (corSet && !corSet.has(up(d.descCorProduto))) return false;
    if (tipoSet && !tipoSet.has(up(d.tipo))) return false;
    return true;
  });
  filtered.sort((a, b) => b.totalRevenue - a.totalRevenue);

  const sumRevenue = filtered.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
  const truncated = filtered.length > ITEM_LIMIT;
  const candidates = truncated ? filtered.slice(0, ITEM_LIMIT) : filtered;

  // ── Lojas da rede (nomes canônicos ativos) + rótulos de exibição (deduplicados) ──
  const company = await resolveCompanyLive(filters.company);
  const filialNames = company ? getOperationalFilials(company, "sales") : [];
  const orderedNames = [...filialNames].sort((a, b) =>
    company
      ? compareFilialDisplayOrder(
          getFilialLabelForDisplay(company, a),
          getFilialLabelForDisplay(company, b),
          company
        )
      : a.localeCompare(b, "pt-BR")
  );
  const labelByName = new Map<string, string>();
  const orderedLabels: string[] = [];
  const seenLabel = new Set<string>();
  for (const name of orderedNames) {
    const label = company ? getFilialLabelForDisplay(company, name) : name;
    labelByName.set(name, label);
    if (!seenLabel.has(label)) {
      seenLabel.add(label);
      orderedLabels.push(label);
    }
  }

  // ── Métricas por loja (1 lote por loja) + trânsito da rede ──
  const itensInput = candidates.map((d) => ({
    produto: String(d.productId ?? "").trim(),
    corProduto: d.corProduto ?? null,
  }));
  // Progresso por loja (cada loja = 1 lote, parte cara da análise). A fase "lojas" começa
  // em 0/N e avança a cada loja concluída; o front mostra "Calculando compra por loja… X/N".
  let lojasFeitas = 0;
  ctx?.onProgress?.(0, orderedNames.length, "lojas");
  const [metricasPorFilial, transitIndex, transferLens] = await Promise.all([
    mapWithConcurrency(orderedNames, FILIAL_CONCURRENCY, (name) =>
      getControleEstoqueMetricasItensBatched({
        company: filters.company,
        filial: name,
        includeHistorico: true,
        itens: itensInput,
      })
        .catch(() => ({}) as Record<string, never>)
        .finally(() => {
          lojasFeitas += 1;
          ctx?.onProgress?.(lojasFeitas, orderedNames.length, "lojas");
        })
    ),
    buildTransitIndex(filters.company),
    // Lente de transferência (opt-in): mesma régua/janela (30d) do Controle de Transferências.
    filters.considerarTransferencias
      ? fetchControleTransferencias({ company: filters.company, filial: null })
          .then((data) => buildTransferLensIndex(data, filters.company as CompanyKey))
          .catch(() => null as TransferLensIndex | null)
      : Promise.resolve(null as TransferLensIndex | null),
  ]);

  const hoje = new Date();
  const dynamicColumns: ReportColumnDef[] = orderedLabels.map((label) => ({
    key: `${COMPRA_FILIAL_COL_PREFIX}${label}`,
    defaultLabel: label,
    type: "int" as const,
  }));

  let acumPerc = 0;
  const rows: ReportRow[] = [];
  for (const d of candidates) {
    const revenue = d.totalRevenue ?? 0;
    const partPerc = sumRevenue !== 0 ? (revenue / sumRevenue) * 100 : 0;
    acumPerc += partPerc;
    const curva = acumPerc <= 60 ? "A" : acumPerc <= 90 ? "B" : "C";

    const pid = String(d.productId ?? "").trim();
    const corKey = d.corProduto ? String(d.corProduto).trim() : null;
    const itemKey = buildControleEstoqueItemKey(d.productId, d.corProduto);
    let transit = transitIndex.get(canonicalKey(pid, corKey)) ?? [];
    if (transit.length === 0) {
      // Fallback por descrição de cor (códigos divergentes para a mesma cor, etc.).
      const dk = transitDescKey(pid, corKey, d.descCorProduto);
      if (dk) transit = transitIndex.get(dk) ?? [];
    }

    // Compra sugerida de cada loja, somada por rótulo (lojas que colapsam no mesmo label).
    const qtyByLabel = new Map<string, number>();
    let total = 0;
    let custoMax = 0;
    orderedNames.forEach((name, idx) => {
      const metricas = metricasPorFilial[idx]?.[itemKey] ?? null;
      const ideal = calcCompraIdealFromResumo(metricas?.resumo ?? null, transit, {
        linha: d.linha,
        subgrupo: d.subgrupo,
        company: filters.company,
      });
      const precisaAgora =
        ideal.status === "REPOR" &&
        (ideal.comprarAgora || precisaComprarEssaSemana(ideal, filters.company, hoje));
      const qtd = precisaAgora ? Math.max(0, ideal.compraIdeal) : 0;
      const label = labelByName.get(name) ?? name;
      if (qtd > 0) qtyByLabel.set(label, (qtyByLabel.get(label) ?? 0) + qtd);
      total += qtd;
      custoMax = Math.max(custoMax, Number(metricas?.resumo?.custoUnitario ?? 0));
    });

    if (total <= 0) continue; // só itens que alguma loja precisa comprar agora/essa semana

    const custoUnit = custoMax > 0 ? custoMax : (d.cost ?? 0);
    const row: ReportRow = {
      [ROW_COR_FIELD]: corKey ?? "",
      CURVA: curva,
      PRODUTO: pid,
      COR: corKey ?? "",
      COR_DESCRICAO: d.descCorProduto ?? "",
      DESCRICAO: d.productName ?? "",
      GRUPO: d.grupo ?? "",
      SUBGRUPO: d.subgrupo ?? "",
      LINHA: d.linha ?? "",
      TIPO: d.tipo ?? "",
      GRADE: d.grade ?? "",
      CUSTO_UNITARIO: round2(custoUnit),
      COMPRA_TOTAL: roundInt(total),
      CUSTO_TOTAL: round2(custoUnit * total),
    };
    for (const dyn of dynamicColumns) {
      const label = dyn.key.slice(COMPRA_FILIAL_COL_PREFIX.length);
      row[dyn.key] = roundInt(qtyByLabel.get(label) ?? 0);
    }

    // Lente de transferência: desconta da compra o que a rede pode mover (read-only).
    if (transferLens) {
      const entry = resolveTransferLens(transferLens, pid, corKey);
      const lente = applyTransferLens(total, entry);
      row.TRANSFERIVEL = roundInt(lente.disponivelTransferir);
      row.COMPRA_LIQUIDA = roundInt(lente.compraLiquida);
      row.CUSTO_LIQUIDO = round2(custoUnit * lente.compraLiquida);
      row.TRANSFERIR_DE = lente.doadoras
        .map((doadora) => `${doadora.origem} (${roundInt(doadora.quantidade)})`)
        .join(" · ");
    }

    rows.push(row);
  }

  const sumQtde = rows.reduce((s, r) => s + Number(r.COMPRA_TOTAL ?? 0), 0);
  const sumCusto = rows.reduce((s, r) => s + Number(r.CUSTO_TOTAL ?? 0), 0);
  const summary: ReportSummaryMetric[] = [
    { label: "Itens p/ comprar", value: rows.length, format: "int" },
    { label: "Qtd total", value: roundInt(sumQtde), format: "int" },
    { label: "Custo total", value: round2(sumCusto), format: "currency" },
  ];

  await applyColecaoLabels(filters.company, rows);

  return { rows, total: rows.length, truncated, summary, dynamicColumns };
}
