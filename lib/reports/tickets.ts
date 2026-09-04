import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const TICKETS_ID = "tickets";

/**
 * Catálogo da análise "Tickets detalhados". O grão é TICKET × produto × cor × tamanho:
 * cada linha é um item vendido, repetindo os dados do ticket (data, filial, vendedor,
 * valor do ticket) para que o XLSX possa agrupar os itens debaixo do seu ticket.
 *
 * As chaves DEVEM bater com `fetchTickets`
 * ([lib/repositories/reportTickets.ts](../repositories/reportTickets.ts)).
 */
export const TICKETS_COLUMNS: ReportColumnDef[] = [
  // ── Cabeçalho do ticket (repetido em todos os itens dele) ──
  { key: "TICKET", defaultLabel: "Ticket", type: "text" },
  { key: "DATA_VENDA", defaultLabel: "Data", type: "date" },
  { key: "FILIAL", defaultLabel: "Filial", type: "text" },
  { key: "VENDEDOR", defaultLabel: "Vendedor", type: "text" },
  { key: "CLIENTE", defaultLabel: "Cliente", type: "text" },
  { key: "VALOR_TICKET", defaultLabel: "Valor do ticket", type: "currency" },
  { key: "PECAS_TICKET", defaultLabel: "Peças do ticket", type: "int" },
  { key: "ITENS_TICKET", defaultLabel: "Itens do ticket", type: "int" },
  // ── Item ──
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "COR_DESCRICAO", defaultLabel: "Cor", type: "text" },
  { key: "COR", defaultLabel: "Cor (cód.)", type: "text" },
  { key: "TAMANHO", defaultLabel: "Tamanho", type: "text" },
  { key: "QTDE_ITEM", defaultLabel: "Qtde", type: "int" },
  { key: "VALOR_ITEM", defaultLabel: "Valor", type: "currency" },
  { key: "DESCONTO_ITEM", defaultLabel: "Desconto", type: "currency" },
  // Preço de tabela do cadastro (PRECO_LIQUIDO da linha de venda), ANTES do desconto —
  // fica por último de propósito: o que se lê primeiro é o Valor que a peça fez.
  { key: "PRECO_UNITARIO", defaultLabel: "Preço Linx", type: "currency" },
  // ── Atributos de cadastro do item ──
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "CODIGO_BARRA", defaultLabel: "Código de barra", type: "text" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? TICKETS_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

/**
 * Chaves de coluna do CABEÇALHO do ticket. O export usa esta lista para montar a faixa
 * de cada ticket (e para NÃO repetir esses valores em cada linha de item).
 */
export const TICKET_HEADER_KEYS = [
  "TICKET",
  "DATA_VENDA",
  "FILIAL",
  "VENDEDOR",
  "CLIENTE",
  "VALOR_TICKET",
  "PECAS_TICKET",
  "ITENS_TICKET",
] as const;

const TICKETS_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-tickets",
    name: "Tickets detalhados",
    builtin: true,
    sortBy: "DATA_VENDA",
    sortDir: "desc",
    columns: [
      col("TICKET"),
      col("DATA_VENDA"),
      col("FILIAL"),
      col("VENDEDOR"),
      col("VALOR_TICKET"),
      col("PECAS_TICKET"),
      col("PRODUTO"),
      col("DESCRICAO"),
      col("COR_DESCRICAO"),
      col("TAMANHO"),
      col("QTDE_ITEM"),
      col("VALOR_ITEM"),
      col("DESCONTO_ITEM"),
      col("PRECO_UNITARIO"),
    ],
  },
  {
    id: "builtin-tickets-completo",
    name: "Tickets detalhados (completo)",
    builtin: true,
    sortBy: "DATA_VENDA",
    sortDir: "desc",
    columns: [
      col("TICKET"),
      col("DATA_VENDA"),
      col("FILIAL"),
      col("VENDEDOR"),
      col("CLIENTE"),
      col("VALOR_TICKET"),
      col("PECAS_TICKET"),
      col("ITENS_TICKET"),
      col("CODIGO_BARRA"),
      col("PRODUTO"),
      col("DESCRICAO"),
      col("COR_DESCRICAO"),
      col("COR"),
      col("TAMANHO"),
      col("QTDE_ITEM"),
      col("VALOR_ITEM"),
      col("DESCONTO_ITEM"),
      col("GRUPO"),
      col("SUBGRUPO"),
      col("LINHA"),
      col("COLECAO"),
      col("GRADE"),
      col("PRECO_UNITARIO"),
    ],
  },
];

export function buildTicketsPresets(): ReportPresetDef[] {
  return TICKETS_PRESETS;
}

export const ticketsMeta: ReportTypeMeta = {
  id: TICKETS_ID,
  label: "Tickets detalhados",
  fileSlug: "tickets",
  description:
    "Os tickets (vendas) do período, abertos item por item: uma linha por produto × cor × tamanho, com o vendedor, o valor do ticket e o valor de cada item. Os filtros de produto (nome, grupo, linha, subgrupo, coleção, cor…) escolhem quais TICKETS entram — e o ticket vem inteiro, com todos os seus itens, mesmo os que não casam com o filtro. Sem filtro nenhum, vêm todos os tickets do período com os totais. Só venda de loja física (POS): ticket e vendedor não existem no e-commerce.",
  supportedFilters: [
    "periodo",
    "filial",
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
  columns: TICKETS_COLUMNS,
  defaultPresets: TICKETS_PRESETS,
  // O grão é ticket × item, não produto × cor: o pós-processamento do runReport (filtro
  // por fornecedor, enrichers e a coluna "Código de barra" anexada no fim) quebraria a
  // integridade do ticket — o filtro de fornecedor apagaria itens de dentro do ticket.
  // A coluna de barra desta análise vem do próprio item vendido (LOJA_VENDA_PRODUTO).
  productBased: false,
};
