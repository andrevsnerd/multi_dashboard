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
  | "grupo"
  | "produto";

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
  /** Empresas onde o tipo aparece (slug). Ausente = todas. */
  companies?: string[];
  /**
   * Descrição alternativa por empresa (slug). Serve quando o mesmo deck muda de
   * vocabulário: no NERD o Top Produtos quebra por GRUPO, não por subgrupo.
   */
  descriptionByCompany?: Record<string, string>;
}

export const TOP_PRODUTOS_ID = "top-produtos";
export const COLECAO_COMPLETA_ID = "colecao-completa";
export const COMPARATIVO_COLECOES_ID = "comparativo-colecoes";
export const COMPARATIVO_RESUMIDO_ID = "comparativo-resumido";
export const PRODUTO_GIRO_ID = "produto-giro";

export const PRESENTATION_TYPES: PresentationTypeMeta[] = [
  {
    id: COLECAO_COMPLETA_ID,
    label: "Relatório Completo de Coleção (com imagens)",
    description:
      "Deck de 5 slides no padrão SCARF·ME: capa com foto da coleção, números, " +
      "performance por produto, vendas por canal/loja e conclusão. Opcionalmente " +
      "destaca um conjunto de produtos da coleção (ex.: “Dracena”) num slide extra. " +
      "Exporta em PDF.",
    supportedFilters: ["colecao", "periodo", "filial"],
    requiresCover: true,
    singleCollection: true,
    companies: ["scarfme"],
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
    companies: ["scarfme"],
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
    companies: ["scarfme"],
  },
  {
    id: PRODUTO_GIRO_ID,
    label: "Relatório Giro de Produtos (com imagens)",
    description:
      "Deck de 10 slides de performance no padrão do exemplo: capa com foto, KPIs, " +
      "ritmo diário, ritmo semanal, salto dos últimos 3 dias, top cores/itens, mix (donut), " +
      "vendas por filial, heatmap cor×dia e síntese. Selecione produtos específicos e os " +
      "filtros da empresa (mesmas regras da página Produto Giro). Exporta em PDF.",
    supportedFilters: ["produto", "periodo", "filial", "grupo", "subgrupo", "colecao", "grade"],
    requiresCover: true,
    singleCollection: false,
  },
  {
    id: TOP_PRODUTOS_ID,
    label: "Top Produtos (Campeões de Venda)",
    description:
      "Deck no padrão “Campeões de venda”: capa, os 10 maiores produtos do período, " +
      "sumário de subgrupos e uma página com o top 10 de cada subgrupo (mais o " +
      "complemento dos subgrupos menores). Ranking por item = produto × cor, " +
      "critério único de faturamento. Filtra por período, filial e (opcional) pelos " +
      "próprios subgrupos — recortando, o deck sai só com as páginas dos selecionados. " +
      "Exporta em PDF A4 paisagem (1280×905 por slide, igual ao modelo).",
    // "subgrupo"/"grupo" = recorte pela DIMENSÃO das páginas; a página mostra só a que
    // vale para a empresa (ScarfMe quebra por subgrupo, NERD por grupo).
    supportedFilters: ["periodo", "filial", "subgrupo", "grupo"],
    requiresCover: true,
    singleCollection: false,
    companies: ["scarfme", "nerd"],
    descriptionByCompany: {
      nerd:
        "Deck no padrão “Campeões de venda”: capa, os 10 maiores produtos do período, " +
        "sumário de grupos e uma página com o top 10 de cada grupo (mais o " +
        "complemento dos grupos menores). Ranking por item = produto × cor, " +
        "critério único de faturamento. A imagem da capa é enviada por você. " +
        "Filtra por período, filial e (opcional) pelos próprios grupos — recortando, o " +
        "deck sai só com as páginas dos selecionados. Exporta em PDF A4 paisagem.",
    },
  },
];

/**
 * Meta de um tipo. Com `company`, aplica a descrição específica da empresa
 * (ex.: Top Produtos fala em "grupos" no NERD e "subgrupos" na ScarfMe).
 */
export function getPresentationMeta(
  id: string,
  company?: string
): PresentationTypeMeta | undefined {
  const meta = PRESENTATION_TYPES.find((t) => t.id === id);
  if (!meta) return undefined;
  const override = company ? meta.descriptionByCompany?.[company] : undefined;
  return override ? { ...meta, description: override } : meta;
}

/** Tipos visíveis para uma empresa (slug). Tipos sem `companies` valem para todas. */
export function getPresentationTypesForCompany(company: string): PresentationTypeMeta[] {
  return PRESENTATION_TYPES.filter((t) => !t.companies || t.companies.includes(company)).map(
    (t) => getPresentationMeta(t.id, company) ?? t
  );
}
