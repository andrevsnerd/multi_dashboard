/**
 * Tipos compartilhados do Gerador de Relatórios.
 *
 * Este arquivo é PURO (sem imports de servidor) para poder ser importado tanto
 * no client (UI da página) quanto no servidor (registry + rotas). Os fetchers
 * que tocam o banco ficam em `registry.server.ts` / repositórios.
 */

export type ColumnType = "text" | "int" | "number" | "currency" | "percent";

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
  | "filial";

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
}
