import "server-only";

import { fetchVendasFaturamento } from "@/lib/repositories/reportVendas";
import { fetchEstoqueRede } from "@/lib/repositories/reportEstoque";
import { fetchProdutosParados } from "@/lib/repositories/reportProdutosParados";
import { fetchProdutosCadastro } from "@/lib/repositories/reportProdutosCadastro";
import { fetchVendasHistorico } from "@/lib/repositories/reportVendasHistorico";
import { fetchMenorCodigoBarra } from "@/lib/repositories/products";
import { runEnricher } from "./enrich.server";
import { canonicalKey, ROW_COR_FIELD } from "./keys";
import { NATIVE_SOURCE, type SourceId } from "./column-sources";
import type { ReportColumnDef, ReportFilters, ReportResult } from "./types";
import { VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";
import { ESTOQUE_REDE_ID } from "./estoque-rede";
import { PRODUTOS_PARADOS_ID } from "./produtos-parados";
import { PRODUTOS_CADASTRO_ID } from "./produtos-cadastro";
import { VENDAS_HISTORICO_ID } from "./vendas-historico";

export type ReportFetcher = (filters: ReportFilters) => Promise<ReportResult>;

/**
 * Mapa de fetchers por tipo de análise. SÓ no servidor (importa repositórios
 * que tocam o banco). Ao adicionar uma análise nova, registre o fetcher aqui.
 */
const FETCHERS: Record<string, ReportFetcher> = {
  [VENDAS_FATURAMENTO_ID]: fetchVendasFaturamento,
  [ESTOQUE_REDE_ID]: fetchEstoqueRede,
  [PRODUTOS_PARADOS_ID]: fetchProdutosParados,
  [PRODUTOS_CADASTRO_ID]: fetchProdutosCadastro,
  [VENDAS_HISTORICO_ID]: fetchVendasHistorico,
};

export function getReportFetcher(id: string): ReportFetcher | undefined {
  return FETCHERS[id];
}

/**
 * Roda a análise base e, se houver fontes extras (colunas de outras análises no preset),
 * enriquece as linhas por produto × cor. As fontes extras só preenchem suas colunas
 * específicas; o universo de linhas continua sendo o da base.
 */
export async function runReport(
  reportType: string,
  filters: ReportFilters,
  extraSources: SourceId[]
): Promise<ReportResult | null> {
  const base = getReportFetcher(reportType);
  if (!base) return null;

  const result = await base(filters);

  // Filtro de dias parado: quando ativo numa análise cuja base NÃO é parados (ex.: estoque
  // por filial), força a fonte "parados" a rodar para popular DIAS_PARADO, mesmo que a
  // coluna não esteja habilitada — o filtro abaixo precisa do valor.
  const diasCorte =
    filters.diasParadoValor != null && Number.isFinite(filters.diasParadoValor)
      ? filters.diasParadoValor
      : null;
  const sources = new Set<SourceId>(extraSources ?? []);
  if (diasCorte != null && NATIVE_SOURCE[reportType] !== "parados") {
    sources.add("parados");
  }

  for (const source of sources) {
    const enr = await runEnricher(source, filters, result.rows);
    for (const row of result.rows) {
      if (enr.defaults) Object.assign(row, enr.defaults);
      const partial = enr.byKey.get(canonicalKey(row.PRODUTO, row[ROW_COR_FIELD]));
      if (partial) Object.assign(row, partial);
    }
  }

  // Aplica o filtro de dias parado depois do enriquecimento (a base parados já filtra no
  // próprio fetcher; aqui cobre as demais análises). "lte" = até X dias; "gte" = X ou mais.
  if (diasCorte != null) {
    const modo = filters.diasParadoModo === "lte" ? "lte" : "gte";
    result.rows = result.rows.filter((row) => {
      const dv = row.DIAS_PARADO;
      if (dv == null || dv === "") return false;
      const n = Number(dv);
      if (!Number.isFinite(n)) return false;
      return modo === "lte" ? n <= diasCorte : n >= diasCorte;
    });
    result.total = result.rows.length;
  }

  // Coluna "Código de barra" no FIM de toda análise: o menor código (interno, não o EAN
  // grande), por produto×cor. Anexada como coluna dinâmica (após as colunas de filial),
  // então aparece na tabela e no export de qualquer preset.
  await appendCodigoBarra(result);

  return result;
}

const CODIGO_BARRA_COL: ReportColumnDef = {
  key: "CODIGO_BARRA",
  defaultLabel: "Código de barra",
  type: "text",
};

/** Preenche row.CODIGO_BARRA (menor código por produto×cor) e registra a coluna dinâmica. */
async function appendCodigoBarra(result: ReportResult): Promise<void> {
  if (result.rows.length === 0) return;

  const produtos = result.rows.map((r) => String(r.PRODUTO ?? "").trim()).filter(Boolean);
  const codigos = await fetchMenorCodigoBarra(produtos).catch(() => []);

  // Mapa por chave canônica (produto×cor) — tolerante a zero à esquerda na cor, igual aos
  // enrichers. Fallback por produto cobre linhas cuja cor não casa (ex.: cor vazia).
  const byKey = new Map<string, string>();
  const byProduto = new Map<string, string>();
  for (const c of codigos) {
    if (!c.codigoBarra) continue;
    const k = canonicalKey(c.produto, c.cor);
    if (!byKey.has(k)) byKey.set(k, c.codigoBarra);
    if (!byProduto.has(c.produto)) byProduto.set(c.produto, c.codigoBarra);
  }

  for (const row of result.rows) {
    const produto = String(row.PRODUTO ?? "").trim();
    const k = canonicalKey(row.PRODUTO, row[ROW_COR_FIELD]);
    row.CODIGO_BARRA = byKey.get(k) ?? byProduto.get(produto) ?? "";
  }

  // Coluna dinâmica por ÚLTIMO (depois das colunas de filial, se houver).
  result.dynamicColumns = [...(result.dynamicColumns ?? []), CODIGO_BARRA_COL];
}
