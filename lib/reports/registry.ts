import type { ReportTypeMeta } from "./types";
import { vendasFaturamentoMeta, VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";

/**
 * Registry PURO de tipos de análise (apenas metadados/colunas/presets).
 * Importável no client. Os fetchers que tocam o banco ficam em
 * `registry.server.ts`.
 *
 * Para adicionar uma nova análise (entradas, estoque, ...): crie um módulo
 * com seu `ReportTypeMeta`, registre aqui e registre o fetcher em
 * `registry.server.ts`.
 */
export const REPORT_TYPES: ReportTypeMeta[] = [vendasFaturamentoMeta];

export function getReportMeta(id: string): ReportTypeMeta | undefined {
  return REPORT_TYPES.find((r) => r.id === id);
}

export { VENDAS_FATURAMENTO_ID };
