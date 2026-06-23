/**
 * Tipos compartilhados do Gerador de Relatórios.
 *
 * Este arquivo é PURO (sem imports de servidor) para poder ser importado tanto
 * no client (UI da página) quanto no servidor (registry + rotas). Os fetchers
 * que tocam o banco ficam em `registry.server.ts` / repositórios.
 */

export type ColumnType =
  | "text"
  | "int"
  | "number"
  | "currency"
  | "percent"
  /** Dias parado: número de dias; valor >= 9999 (sentinela) exibe "Nunca vendeu". */
  | "diasParado"
  /** Última venda: data ISO (yyyy-mm-dd); vazio/nulo exibe "Nunca vendeu". */
  | "dataVenda"
  /** Data genérica: ISO (yyyy-mm-dd) → dd/mm/yyyy; vazio fica em branco. */
  | "date";

/** Catálogo de uma coluna disponível em uma análise. */
export interface ReportColumnDef {
  /** Chave estável usada nas linhas (ReportRow) e nos presets. Ex.: "FATURAMENTO". */
  key: string;
  /** Rótulo padrão exibido quando o preset não sobrescreve. */
  defaultLabel: string;
  type: ColumnType;
  /** Se a tabela permite ordenar por esta coluna (default true). */
  sortable?: boolean;
}

/** Coluna dentro de um preset: a ordem do array define a ordem das colunas. */
export interface ReportPresetColumn {
  key: string;
  /** Nome exibido (sobrescreve o defaultLabel da coluna). */
  label: string;
}

export interface ReportPresetDef {
  id: string;
  name: string;
  columns: ReportPresetColumn[];
  /** Ordenação inicial sugerida (chave de coluna). */
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** true para presets padrão do sistema (não editáveis/excluíveis no backend). */
  builtin?: boolean;
  /**
   * Quando true, a análise busca o estoque detalhado por filial e ANEXA, após as
   * colunas fixas, uma coluna por filial (rede inteira). As colunas por filial são
   * dinâmicas (dependem da empresa) — vêm em `ReportResult.dynamicColumns`.
   */
  dynamicFilialStock?: boolean;
  /**
   * Quando true (junto de `dynamicFilialStock`), anexa também a quantidade vendida
   * por filial, INTERCALADA com o estoque: por filial → "{filial} Venda", "{filial} Estoque".
   */
  dynamicFilialSales?: boolean;
}

export type ReportFilterKey =
  | "periodo"
  | "nome"
  | "cor"
  | "linha"
  | "subgrupo"
  | "grupo"
  | "grade"
  | "colecao"
  | "tipo"
  | "filial"
  | "diasParado"
  | "saldoEstoque";

/** Metadados puros de um tipo de análise (sem o fetcher). */
export interface ReportTypeMeta {
  id: string;
  label: string;
  description: string;
  supportedFilters: ReportFilterKey[];
  columns: ReportColumnDef[];
  defaultPresets: ReportPresetDef[];
}

export type ReportCellValue = string | number | null;
export type ReportRow = Record<string, ReportCellValue>;

/** Filtros enviados do front e consumidos pelos fetchers. */
export interface ReportFilters {
  company?: string;
  filial?: string | null;
  start?: string;
  end?: string;
  grupos?: string[] | null;
  linhas?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  colecoes?: string[] | null;
  /** Cores por DESCRIÇÃO (ex.: "PRETO"), como devolvido por /api/products/cores. */
  cores?: string[] | null;
  /** Tipos de produto (TIPO_PRODUTO). */
  tipos?: string[] | null;
  produtoSearchTerm?: string | null;
  produtoId?: string | null;
  /** Limite de linhas retornadas (default no repositório). */
  limit?: number;
  /** Filtro opcional de dias parado (análise Produtos Parados). Nº de dias de corte. */
  diasParadoValor?: number | null;
  /** Modo do corte: "lte" = até X dias; "gte" = igual ou mais de X dias. */
  diasParadoModo?: "lte" | "gte" | null;
  /** Quando true, calcula e anexa estoque por filial (rede inteira) por linha. */
  estoquePorFilial?: boolean;
  /** Quando true, calcula e anexa a quantidade vendida por filial (rede inteira) por linha. */
  vendasPorFilial?: boolean;
  /** Estoque por filial: além dos positivos, lista também itens zerados (saldo 0 em tudo). */
  incluirZerados?: boolean;
  /** Estoque por filial: além dos positivos, lista também itens só negativos. */
  incluirNegativos?: boolean;
  /** Quando true, calcula a Compra Ideal por produto (caro — limita as linhas). */
  compraIdeal?: boolean;
}

/** Cartão de KPI exibido no topo do resultado (ex.: Vendas Total, Ticket Médio). */
export interface ReportSummaryMetric {
  label: string;
  value: number;
  format: "currency" | "int" | "number";
}

export interface ReportResult {
  rows: ReportRow[];
  /** Total de linhas encontradas antes de aplicar o limite. */
  total: number;
  /** true quando `total` excedeu o limite e o resultado foi cortado. */
  truncated: boolean;
  /** KPIs opcionais (específicos da análise) exibidos como cartões no topo. */
  summary?: ReportSummaryMetric[];
  /**
   * Colunas extras geradas dinamicamente pela análise (ex.: uma coluna de estoque
   * por filial). O front mescla estas ao catálogo e as anexa às colunas habilitadas.
   */
  dynamicColumns?: ReportColumnDef[];
}
