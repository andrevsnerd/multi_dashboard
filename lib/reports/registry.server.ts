import "server-only";

import { fetchVendasFaturamento } from "@/lib/repositories/reportVendas";
import { fetchEstoqueRede } from "@/lib/repositories/reportEstoque";
import { fetchProdutosParados } from "@/lib/repositories/reportProdutosParados";
import { runEnricher } from "./enrich.server";
import { canonicalKey, ROW_COR_FIELD } from "./keys";
import type { SourceId } from "./column-sources";
import type { ReportFilters, ReportResult } from "./types";
import { VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";
import { ESTOQUE_REDE_ID } from "./estoque-rede";
import { PRODUTOS_PARADOS_ID } from "./produtos-parados";

export type ReportFetcher = (filters: ReportFilters) => Promise<ReportResult>;

/**
 * Mapa de fetchers por tipo de análise. SÓ no servidor (importa repositórios
 * que tocam o banco). Ao adicionar uma análise nova, registre o fetcher aqui.
 */
const FETCHERS: Record<string, ReportFetcher> = {
  [VENDAS_FATURAMENTO_ID]: fetchVendasFaturamento,
  [ESTOQUE_REDE_ID]: fetchEstoqueRede,
  [PRODUTOS_PARADOS_ID]: fetchProdutosParados,
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
  if (!extraSources || extraSources.length === 0) return result;

  for (const source of extraSources) {
    const enr = await runEnricher(source, filters, result.rows);
    for (const row of result.rows) {
      if (enr.defaults) Object.assign(row, enr.defaults);
      const partial = enr.byKey.get(canonicalKey(row.PRODUTO, row[ROW_COR_FIELD]));
      if (partial) Object.assign(row, partial);
    }
  }

  return result;
}
