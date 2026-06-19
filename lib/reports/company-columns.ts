import type { CompanyKey } from "@/lib/config/company";
import type { ReportPresetColumn } from "./types";

/**
 * Colunas "líderes" específicas da empresa, usadas no início dos presets das
 * análises (faturamento e estoque):
 *  - NERD     → Grupo
 *  - SCARFME  → Linha, Subgrupo, Grade
 *
 * Centralizado aqui para as duas análises compartilharem exatamente a mesma regra.
 */
export function companyLeadingColumns(companyKey: CompanyKey): ReportPresetColumn[] {
  if (companyKey === "scarfme") {
    return [
      { key: "LINHA", label: "Linha" },
      { key: "SUBGRUPO", label: "Subgrupo" },
      { key: "GRADE", label: "Grade" },
    ];
  }
  return [{ key: "GRUPO", label: "Grupo" }];
}
