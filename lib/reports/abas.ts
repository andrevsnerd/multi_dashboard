import { ROW_COLECAO_COD_FIELD } from "./keys";
import type { ReportFilterKey } from "./types";

/**
 * Dimensões que podem quebrar o relatório em ABAS no XLSX (preset "Faturamento em abas").
 *
 * Regra: uma aba por valor da dimensão (normalmente os valores marcados no filtro
 * correspondente). O agrupamento é feito nas linhas JÁ geradas — nenhuma consulta extra:
 * cada linha carrega o valor da sua dimensão (GRUPO, SUBGRUPO, ...).
 */
export type AbaDimensaoId = "grupo" | "subgrupo" | "linha" | "grade" | "colecao" | "cor" | "tipo";

export interface AbaDimensaoDef {
  id: AbaDimensaoId;
  /** Rótulo exibido na UI e no título da aba (ex.: "Subgrupo"). */
  label: string;
  /** Filtro correspondente (usado para só oferecer dimensões suportadas pela análise). */
  filterKey: ReportFilterKey;
  /** Campo da linha que carrega o valor da dimensão. */
  rowField: string;
  /**
   * Coluna(s) que ficam redundantes dentro da aba (o valor é constante e já aparece no
   * título) e portanto são omitidas naquela planilha.
   */
  hideColumns: string[];
}

export const ABA_DIMENSOES: AbaDimensaoDef[] = [
  { id: "grupo", label: "Grupo", filterKey: "grupo", rowField: "GRUPO", hideColumns: ["GRUPO"] },
  { id: "subgrupo", label: "Subgrupo", filterKey: "subgrupo", rowField: "SUBGRUPO", hideColumns: ["SUBGRUPO"] },
  { id: "linha", label: "Linha", filterKey: "linha", rowField: "LINHA", hideColumns: ["LINHA"] },
  { id: "grade", label: "Grade", filterKey: "grade", rowField: "GRADE", hideColumns: ["GRADE"] },
  {
    id: "colecao",
    label: "Coleção",
    filterKey: "colecao",
    // A linha guarda o código da coleção em campo oculto; a descrição vem do rótulo do filtro.
    rowField: ROW_COLECAO_COD_FIELD,
    hideColumns: ["COLECAO", "COLECAO_COD"],
  },
  { id: "cor", label: "Cor", filterKey: "cor", rowField: "COR_DESCRICAO", hideColumns: ["COR_DESCRICAO"] },
  { id: "tipo", label: "Tipo", filterKey: "tipo", rowField: "TIPO", hideColumns: ["TIPO"] },
];

export function getAbaDimensao(id: string | null | undefined): AbaDimensaoDef | undefined {
  return ABA_DIMENSOES.find((d) => d.id === id);
}
