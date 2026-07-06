/**
 * Registry extensível dos tipos de apresentação do Gerador de Apresentações.
 * Espelha a ideia do `lib/reports/registry.ts` (tipos de análise): a página lê
 * daqui a lista de tipos, quais filtros cada tipo suporta e o que ele exige
 * (ex.: upload de capa, coleção única). Novos tipos entram só adicionando um
 * item nesta lista + a lógica de dados correspondente.
 */

export type PresentationFilterKey =
  | "periodo"
  | "filial"
  | "colecao"
  | "subgrupo"
  | "grade"
  | "grupo";

export interface PresentationTypeMeta {
  id: string;
  label: string;
  description: string;
  /** Filtros exibidos na home para este tipo. */
  supportedFilters: PresentationFilterKey[];
  /** Exibe o campo de upload da imagem de capa da coleção. */
  requiresCover: boolean;
  /** Deck é sobre UMA coleção (título/capa usam a coleção selecionada). */
  singleCollection: boolean;
}

export const COLECAO_COMPLETA_ID = "colecao-completa";
export const COMPARATIVO_COLECOES_ID = "comparativo-colecoes";
export const COMPARATIVO_RESUMIDO_ID = "comparativo-resumido";

export const PRESENTATION_TYPES: PresentationTypeMeta[] = [
  {
    id: COLECAO_COMPLETA_ID,
    label: "Relatório Completo de Coleção (com imagens)",
    description:
      "Deck de 5 slides no padrão SCARF·ME: capa com foto da coleção, números, " +
      "performance por produto, vendas por canal/loja e conclusão. Exporta em PDF.",
    supportedFilters: ["colecao", "periodo", "filial"],
    requiresCover: true,
    singleCollection: true,
  },
  {
    id: COMPARATIVO_COLECOES_ID,
    label: "Relatório Comparativo entre Coleções",
    description:
      "Compara várias coleções (uma por slide, com paleta própria): venda líquida, " +
      "ticket médio, markup, desconto, evolução mensal e um slide final de decisão " +
      "de renovação. Escolha 2 ou mais coleções. Exporta em PDF.",
    supportedFilters: ["colecao", "periodo", "filial"],
    requiresCover: true,
    singleCollection: false,
  },
  {
    id: COMPARATIVO_RESUMIDO_ID,
    label: "Comparativo Resumido de Coleções",
    description:
      "Versão enxuta do comparativo: uma carta compacta por coleção (uma abaixo da " +
      "outra) com foto, venda líquida, quantidade vendida, peças (SKUs) e a evolução " +
      "mensal. Escolha as coleções, envie a foto de cada uma. Exporta em PDF.",
    supportedFilters: ["colecao", "periodo", "filial"],
    requiresCover: true,
    singleCollection: false,
  },
];

export function getPresentationMeta(id: string): PresentationTypeMeta | undefined {
  return PRESENTATION_TYPES.find((t) => t.id === id);
}
