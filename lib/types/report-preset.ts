import type { ReportPresetColumn } from "@/lib/reports/types";

/**
 * Preset de colunas salvo pelo usuário no backend (compartilhado por empresa +
 * tipo de análise). A ordem do array `columns` define a ordem das colunas e
 * cada item carrega o rótulo exibido.
 */
export interface ReportPreset {
  id: string;
  reportType: string;
  companyKey: string;
  name: string;
  columns: ReportPresetColumn[];
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
  ownerUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportPresetInput {
  reportType: string;
  companyKey: string;
  name: string;
  columns: ReportPresetColumn[];
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
  ownerUsername?: string | null;
}
