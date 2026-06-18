import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const VENDAS_FATURAMENTO_ID = "vendas-faturamento";

/**
 * Catálogo completo de colunas da análise "Vendas por faturamento".
 * As chaves DEVEM bater com as chaves produzidas em
 * `fetchVendasFaturamento` (lib/repositories/reportVendas.ts).
 */
export const VENDAS_FATURAMENTO_COLUMNS: ReportColumnDef[] = [
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "COR", defaultLabel: "Cor (cód.)", type: "text" },
  { key: "COR_DESCRICAO", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "TIPO", defaultLabel: "Tipo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "QTDE", defaultLabel: "Qtde", type: "int" },
  { key: "FATURAMENTO", defaultLabel: "Faturamento", type: "currency" },
  { key: "TICKET_MEDIO", defaultLabel: "Preço médio", type: "currency" },
  { key: "CUSTO_UNITARIO", defaultLabel: "Custo unit.", type: "currency" },
  { key: "CUSTO_TOTAL", defaultLabel: "Custo total", type: "currency" },
  { key: "MARKUP", defaultLabel: "Markup", type: "number" },
  { key: "MARGEM", defaultLabel: "Margem (R$)", type: "currency" },
  { key: "MARGEM_PERC", defaultLabel: "Margem (%)", type: "percent" },
  { key: "ESTOQUE", defaultLabel: "Estoque", type: "int" },
  { key: "PRECO_SUGERIDO", defaultLabel: "Preço sugerido", type: "currency" },
  { key: "PARTICIPACAO_PERC", defaultLabel: "Part. (%)", type: "percent" },
  { key: "PARTICIPACAO_ACUM_PERC", defaultLabel: "Part. acum. (%)", type: "percent" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? VENDAS_FATURAMENTO_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const VENDAS_FATURAMENTO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-faturamento",
    name: "Faturamento (padrão)",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("TICKET_MEDIO", "Preço médio"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("MARKUP"),
      col("ESTOQUE"),
    ],
  },
  {
    id: "builtin-margem",
    name: "Margem",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("CUSTO_TOTAL"),
      col("MARGEM"),
      col("MARGEM_PERC"),
      col("MARKUP"),
    ],
  },
  {
    id: "builtin-completo",
    name: "Completo",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: VENDAS_FATURAMENTO_COLUMNS.map((c) => col(c.key)),
  },
];

export const vendasFaturamentoMeta: ReportTypeMeta = {
  id: VENDAS_FATURAMENTO_ID,
  label: "Vendas por faturamento",
  description:
    "Itens vendidos no período (por produto × cor), ordenados por faturamento líquido. Usa a mesma lógica validada da tela de Produtos (trocas, cancelamentos e descontos já tratados).",
  supportedFilters: [
    "periodo",
    "filial",
    "nome",
    "cor",
    "linha",
    "subgrupo",
    "grupo",
    "grade",
    "colecao",
    "tipo",
  ],
  columns: VENDAS_FATURAMENTO_COLUMNS,
  defaultPresets: VENDAS_FATURAMENTO_PRESETS,
};
