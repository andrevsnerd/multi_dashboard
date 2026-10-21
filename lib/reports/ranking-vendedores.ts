import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const RANKING_VENDEDORES_ID = "ranking-vendedores";

/**
 * Prefixo das colunas DINÂMICAS de quantidade por produto filtrado
 * (`VENDEDOR_PRODUTO::<código do produto>`). Só existem quando o filtro de produto deixa
 * 2 ou mais produtos — com um produto só, a coluna repetiria o total.
 */
export const VENDEDOR_PRODUTO_COL_PREFIX = "VENDEDOR_PRODUTO::";
/** Coluna dinâmica que soma os produtos além do teto de colunas por produto. */
export const VENDEDOR_OUTROS_COL = "VENDEDOR_PRODUTO_OUTROS";
/** Máximo de colunas por produto; o resto vai para "Outros produtos". */
export const MAX_COLUNAS_PRODUTO = 20;

/** Campo oculto da linha: "ECOMMERCE" na linha do site (fica fora da numeração do ranking). */
export const RANKING_CANAL_FIELD = "__canal";

/** Chaves de `ReportResult.sideTables` desta análise. */
export const SIDE_PRODUTOS = "produtos";
export const SIDE_VENDEDOR_PRODUTO = "vendedorProduto";

/**
 * Catálogo da análise "Ranking de vendedores". O grão é o VENDEDOR: uma linha por vendedor
 * com o que ele vendeu dos produtos filtrados (sem filtro: de todos os produtos).
 *
 * As chaves DEVEM bater com `fetchRankingVendedores`
 * ([lib/repositories/reportRankingVendedores.ts](../repositories/reportRankingVendedores.ts)).
 */
export const RANKING_VENDEDORES_COLUMNS: ReportColumnDef[] = [
  { key: "POSICAO", defaultLabel: "#", type: "int" },
  { key: "VENDEDOR", defaultLabel: "Vendedor", type: "text" },
  { key: "VENDEDOR_CODIGO", defaultLabel: "Cód. vendedor", type: "text" },
  { key: "FILIAL", defaultLabel: "Filial", type: "text" },
  { key: "QTDE", defaultLabel: "Peças", type: "int" },
  { key: "PARTICIPACAO", defaultLabel: "% das peças", type: "percent" },
  { key: "FATURAMENTO", defaultLabel: "Faturamento", type: "currency" },
  { key: "TICKETS", defaultLabel: "Tickets", type: "int" },
  { key: "PECAS_POR_TICKET", defaultLabel: "Peças por ticket", type: "number" },
  { key: "PRECO_MEDIO", defaultLabel: "Preço médio", type: "currency" },
  { key: "PRODUTOS_DISTINTOS", defaultLabel: "Produtos diferentes", type: "int" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? RANKING_VENDEDORES_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const RANKING_VENDEDORES_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-ranking-vendedores",
    name: "Ranking de vendedores",
    builtin: true,
    sortBy: "QTDE",
    sortDir: "desc",
    columns: [
      col("POSICAO"),
      col("VENDEDOR"),
      col("FILIAL"),
      col("QTDE"),
      col("PARTICIPACAO"),
      col("FATURAMENTO"),
      col("TICKETS"),
      col("PRECO_MEDIO"),
    ],
  },
];

export function buildRankingVendedoresPresets(): ReportPresetDef[] {
  return RANKING_VENDEDORES_PRESETS;
}

export const rankingVendedoresMeta: ReportTypeMeta = {
  id: RANKING_VENDEDORES_ID,
  label: "Ranking de vendedores",
  fileSlug: "ranking-vendedores",
  description:
    "Quem mais vendeu os produtos que você filtrar — uma linha por vendedor, ordenada pelas peças vendidas, com faturamento (regra com trocas), tickets e preço médio. Sem filtro de produto, o ranking é de todos os produtos. Com 2 ou mais produtos filtrados, cada produto ganha uma coluna com a quantidade que o vendedor vendeu dele. Diferente dos Tickets detalhados, aqui conta SÓ o item filtrado, não o ticket inteiro. Com todas as filiais, o e-commerce aparece numa linha à parte (fora da numeração).",
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
  columns: RANKING_VENDEDORES_COLUMNS,
  defaultPresets: RANKING_VENDEDORES_PRESETS,
  // O grão é o vendedor, não produto × cor: o pós-processamento de produto do runReport
  // (enrichers, coluna "Código de barra") não se aplica. O filtro de fornecedor é aplicado
  // dentro do próprio fetcher, item a item, ANTES de somar por vendedor.
  productBased: false,
};
