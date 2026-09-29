import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const VENDAS_POR_PRECO_ID = "vendas-por-preco";

/**
 * Catálogo da análise "Vendas por preço". O grão é o TICKET: uma linha por venda, com o
 * valor líquido do ticket inteiro. O filtro principal é o valor mínimo do ticket
 * (`valorMinimoTicket`, "igual ou maior que").
 *
 * As chaves DEVEM bater com `fetchVendasPorPreco`
 * ([lib/repositories/reportVendasPorPreco.ts](../repositories/reportVendasPorPreco.ts)).
 */
export const VENDAS_POR_PRECO_COLUMNS: ReportColumnDef[] = [
  // Loja (ticket do POS) ou E-commerce (nota fiscal — lá não existe ticket).
  { key: "CANAL", defaultLabel: "Canal", type: "text" },
  { key: "TICKET", defaultLabel: "Ticket / NF", type: "text" },
  { key: "DATA_VENDA", defaultLabel: "Data", type: "date" },
  { key: "FILIAL", defaultLabel: "Filial", type: "text" },
  { key: "VENDEDOR", defaultLabel: "Vendedor", type: "text" },
  { key: "CLIENTE", defaultLabel: "Cliente", type: "text" },
  { key: "CPF", defaultLabel: "CPF", type: "text" },
  { key: "VALOR_TICKET", defaultLabel: "Valor do ticket", type: "currency" },
  { key: "PECAS_TICKET", defaultLabel: "Peças", type: "int" },
  { key: "ITENS_TICKET", defaultLabel: "Itens", type: "int" },
  { key: "DESCONTO_TICKET", defaultLabel: "Desconto", type: "currency" },
  { key: "PRECO_MEDIO_PECA", defaultLabel: "Preço médio por peça", type: "currency" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? VENDAS_POR_PRECO_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const VENDAS_POR_PRECO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-vendas-por-preco",
    name: "Vendas por preço",
    builtin: true,
    sortBy: "VALOR_TICKET",
    sortDir: "desc",
    columns: [
      col("CANAL"),
      col("TICKET"),
      col("DATA_VENDA"),
      col("FILIAL"),
      col("VENDEDOR"),
      col("CLIENTE"),
      col("VALOR_TICKET"),
      col("PECAS_TICKET"),
      col("ITENS_TICKET"),
      col("DESCONTO_TICKET"),
      col("PRECO_MEDIO_PECA"),
    ],
  },
];

export function buildVendasPorPrecoPresets(): ReportPresetDef[] {
  return VENDAS_POR_PRECO_PRESETS;
}

export const vendasPorPrecoMeta: ReportTypeMeta = {
  id: VENDAS_POR_PRECO_ID,
  label: "Vendas por preço",
  fileSlug: "vendas-por-preco",
  description:
    "Os tickets (vendas) do período com valor IGUAL OU MAIOR que o informado — uma linha por ticket, com o valor líquido do ticket inteiro (regra de faturamento com trocas), peças, vendedor e cliente. Os filtros de produto (grupo, linha, subgrupo, coleção, cor…) escolhem os tickets que contêm ao menos um item daquele filtro; o valor comparado é sempre o do ticket inteiro. Sem valor, lista todos os tickets do período do maior para o menor. Inclui o e-commerce: lá a venda é a nota fiscal (coluna Canal = E-commerce), pela regra de faturamento do e-commerce.",
  supportedFilters: [
    "periodo",
    "filial",
    "valorTicket",
    "grupo",
    "linha",
    "subgrupo",
    "grade",
    "colecao",
    "cor",
    "tipo",
    "nome",
    "produtos",
  ],
  columns: VENDAS_POR_PRECO_COLUMNS,
  defaultPresets: VENDAS_POR_PRECO_PRESETS,
  // Grão de ticket, não produto × cor: o pós-processamento de produto do runReport
  // (fornecedor, enrichers, coluna "Código de barra") não se aplica.
  productBased: false,
};
