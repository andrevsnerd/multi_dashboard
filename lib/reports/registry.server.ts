import "server-only";

import { fetchVendasFaturamento } from "@/lib/repositories/reportVendas";
import { fetchEstoqueRede } from "@/lib/repositories/reportEstoque";
import { fetchProdutosParados } from "@/lib/repositories/reportProdutosParados";
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
