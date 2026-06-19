import type { CompanyKey } from "@/lib/config/company";
import type { ReportPresetDef, ReportTypeMeta } from "./types";
import {
  buildVendasFaturamentoPresets,
  vendasFaturamentoMeta,
  VENDAS_FATURAMENTO_ID,
} from "./vendas-faturamento";
import { buildEstoqueRedePresets, estoqueRedeMeta, ESTOQUE_REDE_ID } from "./estoque-rede";

/**
 * Registry PURO de tipos de análise (apenas metadados/colunas/presets).
 * Importável no client. Os fetchers que tocam o banco ficam em
 * `registry.server.ts`.
 *
 * Para adicionar uma nova análise (entradas, estoque, ...): crie um módulo
 * com seu `ReportTypeMeta`, registre aqui e registre o fetcher em
 * `registry.server.ts`.
 */
export const REPORT_TYPES: ReportTypeMeta[] = [vendasFaturamentoMeta, estoqueRedeMeta];

export function getReportMeta(id: string): ReportTypeMeta | undefined {
  return REPORT_TYPES.find((r) => r.id === id);
}

/**
 * Presets padrão de uma análise para uma empresa. Alguns presets variam por empresa
 * (ex.: colunas líderes Grupo / Linha+Subgrupo+Grade no vendas-faturamento).
 */
export function getDefaultPresets(id: string, companyKey: CompanyKey): ReportPresetDef[] {
  if (id === VENDAS_FATURAMENTO_ID) {
    return buildVendasFaturamentoPresets(companyKey);
  }
  if (id === ESTOQUE_REDE_ID) {
    return buildEstoqueRedePresets(companyKey);
  }
  return getReportMeta(id)?.defaultPresets ?? [];
}

export { VENDAS_FATURAMENTO_ID };
