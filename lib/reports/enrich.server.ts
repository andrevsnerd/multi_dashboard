import "server-only";

import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchMultipleProductsStockByColor } from "@/lib/repositories/inventory";
import {
  fetchProdutosParadosDetalhado,
  fetchEstoqueRedePorProduto,
} from "@/lib/repositories/controleEstoque";
import { canonicalKey, rawKey, diasDesde, ROW_COR_FIELD } from "./keys";
import { DIAS_PARADO_NUNCA, ULTIMA_VENDA_NUNCA } from "./format";
import type { ReportFilters, ReportRow } from "./types";
import type { SourceId } from "./column-sources";

/** Resultado de um enricher: colunas por chave canônica + defaults p/ linhas sem match. */
export interface EnrichResult {
  /** chave canônica (produto|corCanon) → colunas a mesclar. */
  byKey: Map<string, Partial<ReportRow>>;
  /** valores default aplicados a TODA linha-base antes do match (ex.: 0 p/ faturamento). */
  defaults?: Partial<ReportRow>;
}

function round2(v: number | null | undefined): number {
  return v == null || !Number.isFinite(v) ? 0 : Math.round(v * 100) / 100;
}
function roundInt(v: number | null | undefined): number {
  return v == null || !Number.isFinite(v) ? 0 : Math.round(v);
}

/** Métricas de vendas por produto × cor (faturamento, qtde, custo, margem…). */
async function enrichVendas(filters: ReportFilters): Promise<EnrichResult> {
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
  });

  const byKey = new Map<string, Partial<ReportRow>>();
  for (const d of details) {
    const qty = d.totalQuantity ?? 0;
    const custoUnit = d.cost ?? 0;
    const custoTotal = custoUnit * qty;
    const revenue = d.totalRevenue ?? 0;
    const margem = revenue - custoTotal;
    byKey.set(canonicalKey(d.productId, d.corProduto), {
      QTDE: roundInt(qty),
      FATURAMENTO: round2(revenue),
      TICKET_MEDIO: round2(d.averagePrice),
      CUSTO_UNITARIO: round2(custoUnit),
      CUSTO_TOTAL: round2(custoTotal),
      MARKUP: round2(d.markup),
      MARGEM: round2(margem),
      MARGEM_PERC: revenue !== 0 ? round2((margem / revenue) * 100) : 0,
      PRECO_SUGERIDO: d.suggestedPrice != null ? round2(d.suggestedPrice) : null,
    });
  }
  // Produto da base sem venda no período → métricas 0 (em vez de vazio).
  const defaults: Partial<ReportRow> = {
    QTDE: 0,
    FATURAMENTO: 0,
    TICKET_MEDIO: 0,
    CUSTO_UNITARIO: 0,
    CUSTO_TOTAL: 0,
    MARKUP: 0,
    MARGEM: 0,
    MARGEM_PERC: 0,
    PRECO_SUGERIDO: null,
  };
  return { byKey, defaults };
}

/** Dias parado e última venda por produto × cor. */
async function enrichParados(filters: ReportFilters): Promise<EnrichResult> {
  const itens = await fetchProdutosParadosDetalhado({
    company: filters.company,
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    colecoes: filters.colecoes ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    minDias: 0,
  });

  const byKey = new Map<string, Partial<ReportRow>>();
  for (const d of itens) {
    const nuncaVendeu = !d.ultimaVenda || d.diasParado >= DIAS_PARADO_NUNCA;
    byKey.set(canonicalKey(d.produto, d.corCodigo), {
      DIAS_PARADO: nuncaVendeu ? DIAS_PARADO_NUNCA : roundInt(d.diasParado),
      ULTIMA_VENDA: nuncaVendeu ? ULTIMA_VENDA_NUNCA : d.ultimaVenda,
    });
  }
  // Sem default: produto fora do escopo de estoque fica em branco (≠ "Nunca vendeu").
  return { byKey };
}

/** Estoque total (rede, positivo) por produto × cor — recebe os pares da base. */
async function enrichEstoque(
  filters: ReportFilters,
  baseRows: ReportRow[]
): Promise<EnrichResult> {
  const pairs = baseRows.map((r) => ({
    productId: String(r.PRODUTO ?? "").trim(),
    corProduto: String(r[ROW_COR_FIELD] ?? "").trim(),
  }));
  const stockMap = await fetchMultipleProductsStockByColor(pairs, {
    company: filters.company,
    filial: null, // rede inteira
  });

  const byKey = new Map<string, Partial<ReportRow>>();
  for (const p of pairs) {
    const total = stockMap.get(rawKey(p.productId, p.corProduto)) ?? 0;
    byKey.set(canonicalKey(p.productId, p.corProduto), { ESTOQUE_TOTAL: roundInt(total) });
  }
  return { byKey, defaults: { ESTOQUE_TOTAL: 0 } };
}

/** Data de cadastro e dias desde o cadastro por produto × cor. */
async function enrichCadastro(filters: ReportFilters): Promise<EnrichResult> {
  const itens = await fetchEstoqueRedePorProduto({
    company: filters.company,
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    cores: filters.cores ?? null,
    tipos: filters.tipos ?? null,
    produtoId: filters.produtoId ?? null,
    produtoSearchTerm: filters.produtoSearchTerm ?? null,
  });

  const nowMs = Date.now();
  const byKey = new Map<string, Partial<ReportRow>>();
  for (const d of itens) {
    const key = canonicalKey(d.produto, d.corCodigo);
    if (byKey.has(key)) continue;
    const dias = diasDesde(d.dataCadastro, nowMs);
    byKey.set(key, {
      DATA_CADASTRO: d.dataCadastro,
      DIAS_CADASTRO: dias == null ? null : roundInt(dias),
    });
  }
  return { byKey };
}

/** Executa o enricher de uma fonte. */
export async function runEnricher(
  source: SourceId,
  filters: ReportFilters,
  baseRows: ReportRow[]
): Promise<EnrichResult> {
  if (source === "vendas") return enrichVendas(filters);
  if (source === "parados") return enrichParados(filters);
  if (source === "cadastro") return enrichCadastro(filters);
  return enrichEstoque(filters, baseRows);
}
