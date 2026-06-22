import "server-only";

import { fetchVendasFaturamento } from "@/lib/repositories/reportVendas";
import { fetchEstoqueRede } from "@/lib/repositories/reportEstoque";
import { fetchProdutosParados } from "@/lib/repositories/reportProdutosParados";
import { fetchProdutosCadastro } from "@/lib/repositories/reportProdutosCadastro";
import { runEnricher } from "./enrich.server";
import { canonicalKey, ROW_COR_FIELD } from "./keys";
import { NATIVE_SOURCE, type SourceId } from "./column-sources";
import type { ReportFilters, ReportResult } from "./types";
import { VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";
import { ESTOQUE_REDE_ID } from "./estoque-rede";
import { PRODUTOS_PARADOS_ID } from "./produtos-parados";
import { PRODUTOS_CADASTRO_ID } from "./produtos-cadastro";

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

  return result;
}
