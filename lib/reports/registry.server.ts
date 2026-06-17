import "server-only";

import { fetchVendasFaturamento } from "@/lib/repositories/reportVendas";
import type { ReportFilters, ReportResult } from "./types";
import { VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";

export type ReportFetcher = (filters: ReportFilters) => Promise<ReportResult>;

/**
 * Mapa de fetchers por tipo de análise. SÓ no servidor (importa repositórios
 * que tocam o banco). Ao adicionar uma análise nova, registre o fetcher aqui.
 */
const FETCHERS: Record<string, ReportFetcher> = {
  [VENDAS_FATURAMENTO_ID]: fetchVendasFaturamento,
};

export function getReportFetcher(id: string): ReportFetcher | undefined {
  return FETCHERS[id];
}
