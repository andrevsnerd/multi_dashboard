import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const CUSTOS_DEFEITOS_ID = "custos-defeitos";

/**
 * Catálogo da análise "Custos de Defeitos". Não é uma consulta de venda nem de estoque:
 * a entrada é uma LISTA COLADA de códigos (o mesmo hábito da Lista Loja) e cada linha
 * repetida conta +1 na quantidade. O resultado é o custo unitário (CUSTO_REPOSICAO1 do
 * cadastro) × quantidade, com o total somado no rodapé do XLSX.
 *
 * As chaves DEVEM bater com `fetchCustosDefeitos`
 * ([lib/repositories/reportCustosDefeitos.ts](../repositories/reportCustosDefeitos.ts)).
 */
export const CUSTOS_DEFEITOS_COLUMNS: ReportColumnDef[] = [
  { key: "CODIGO_BARRA", defaultLabel: "Código de barra", type: "text" },
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "COR_DESCRICAO", defaultLabel: "Cor", type: "text" },
  { key: "COR", defaultLabel: "Cor (cód.)", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "QUANTIDADE", defaultLabel: "Qtde", type: "int" },
  { key: "CUSTO_UNITARIO", defaultLabel: "Custo unit.", type: "currency" },
  { key: "CUSTO_TOTAL", defaultLabel: "Custo total", type: "currency" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? CUSTOS_DEFEITOS_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const CUSTOS_DEFEITOS_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-custos-defeitos",
    name: "Custos de defeitos",
    builtin: true,
    sortBy: "CUSTO_TOTAL",
    sortDir: "desc",
    columns: [
      col("CODIGO_BARRA"),
      col("PRODUTO"),
      col("DESCRICAO"),
      col("COR_DESCRICAO"),
      col("QUANTIDADE"),
      col("CUSTO_UNITARIO"),
      col("CUSTO_TOTAL"),
    ],
  },
];

export function buildCustosDefeitosPresets(): ReportPresetDef[] {
  return CUSTOS_DEFEITOS_PRESETS;
}

export const custosDefeitosMeta: ReportTypeMeta = {
  id: CUSTOS_DEFEITOS_ID,
  label: "Custos de defeitos",
  description:
    "Cole a lista de produtos defeituosos (um código por linha, de barra ou do produto — igual à Lista Loja). Cada repetição conta +1 na quantidade. Devolve o detalhe do item, o custo unitário do cadastro, o custo total de cada linha e a soma geral. Não consulta estoque nem venda.",
  // Sem filtros: a entrada é a lista colada (a tela mostra o campo próprio desta análise).
  supportedFilters: [],
  columns: CUSTOS_DEFEITOS_COLUMNS,
  defaultPresets: CUSTOS_DEFEITOS_PRESETS,
  // Não é análise por produto × cor vinda de venda/estoque: pula o pós-processamento do
  // runReport (fornecedor, enrichers e a coluna "Código de barra" anexada no fim — esta
  // análise já traz a barra na 1ª coluna, que é o que se lê na peça defeituosa).
  productBased: false,
};
