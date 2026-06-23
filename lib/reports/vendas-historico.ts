import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const VENDAS_HISTORICO_ID = "vendas-historico";

/**
 * Catálogo de colunas da análise "Histórico de vendas" (nível de transação).
 * Cada linha = um item vendido em um ticket: quando, onde (filial) e quem (vendedor).
 * SEM agrupar/somar — espelha LOJA_VENDA_PRODUTO (vendas de loja/POS).
 */
export const VENDAS_HISTORICO_COLUMNS: ReportColumnDef[] = [
  { key: "DATA_VENDA", defaultLabel: "Data", type: "date" },
  { key: "TICKET", defaultLabel: "Ticket", type: "text" },
  { key: "FILIAL", defaultLabel: "Filial", type: "text" },
  { key: "VENDEDOR", defaultLabel: "Vendedor", type: "text" },
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "COR", defaultLabel: "Cor (cód.)", type: "text" },
  { key: "COR_DESCRICAO", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "TAMANHO", defaultLabel: "Tam.", type: "int" },
  { key: "QTDE", defaultLabel: "Qtde", type: "int" },
  { key: "PRECO_LIQUIDO", defaultLabel: "Preço unit.", type: "currency" },
  { key: "VALOR", defaultLabel: "Venda Líquida", type: "currency" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "TIPO", defaultLabel: "Tipo", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? VENDAS_HISTORICO_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const VENDAS_HISTORICO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-historico-vendas",
    name: "Histórico de vendas",
    builtin: true,
    // Mais recentes primeiro — é um log de quando/onde/quem vendeu.
    sortBy: "DATA_VENDA",
    sortDir: "desc",
    columns: [
      col("DATA_VENDA"),
      col("FILIAL"),
      col("VENDEDOR"),
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("PRECO_LIQUIDO"),
      col("VALOR"),
    ],
  },
  {
    id: "builtin-historico-completo",
    name: "Completo",
    builtin: true,
    sortBy: "DATA_VENDA",
    sortDir: "desc",
    columns: VENDAS_HISTORICO_COLUMNS.map((c) => col(c.key)),
  },
];

export function buildVendasHistoricoPresets(): ReportPresetDef[] {
  return VENDAS_HISTORICO_PRESETS;
}

export const vendasHistoricoMeta: ReportTypeMeta = {
  id: VENDAS_HISTORICO_ID,
  label: "Histórico de vendas",
  description:
    "Cada venda registrada de um item, sem agrupar: data, filial e vendedor de cada saída — loja (POS) e e-commerce (faturamento, sem vendedor). Use o filtro de produto para ver o histórico de um item específico.",
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
  columns: VENDAS_HISTORICO_COLUMNS,
  defaultPresets: VENDAS_HISTORICO_PRESETS,
};
