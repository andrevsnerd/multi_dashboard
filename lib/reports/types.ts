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
  | "date"
  /**
   * Dias até o estoque acabar (Projeção de vendas): número de dias; sentinelas exibem
   * "Mais de 12 meses" (não acaba no horizonte) e "Sem giro" (ritmo zero). Ambas as
   * sentinelas são números altos para ordenarem no fim.
   */
  | "diasAcabar";

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
  /**
   * Compra sugerida ABC: quando true, este preset também agrega itens em ruptura (estoque
   * zerado/negativo numa loja que precisa repor mas ainda não bateu o corte de "comprar
   * agora/essa semana"). Reaproveita o cálculo já feito por item×loja — sem custo extra.
   */
  incluirRupturas?: boolean;
  /**
   * Quando true, o export XLSX é QUEBRADO EM ABAS por uma dimensão de filtro (ex.: 5
   * subgrupos selecionados → 5 abas, cada uma com seus itens ordenados e o painel de
   * totais só daquela aba, mais uma aba "Resumo" comparando todas). Só afeta o export —
   * a consulta e a tabela na tela continuam iguais. Ver lib/reports/abas.ts.
   */
  abasPorFiltro?: boolean;
}

export type ReportFilterKey =
  | "periodo"
  | "nome"
  /** Seleção de VÁRIOS produtos (chips) — a análise recebe `produtoIds`. */
  | "produtos"
  /** Opções da Projeção de vendas: janela do ritmo + sazonalidade. */
  | "projecao"
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
  /**
   * Apelido curto usado no NOME DO ARQUIVO exportado (ex.: "vendas", "parados").
   * Sem isso o nome herdaria o `label` inteiro ("Vendas por faturamento") e ficaria
   * gigante — ver [lib/utils/reportFilename.ts].
   */
  fileSlug?: string;
  supportedFilters: ReportFilterKey[];
  columns: ReportColumnDef[];
  defaultPresets: ReportPresetDef[];
  /**
   * Quando `false`, a análise NÃO é por produto × cor (ex.: Clientes por Filial).
   * O `runReport` então pula o pós-processamento específico de produto: filtro por
   * grupo de fornecedor e a coluna dinâmica "Código de barra". Default: true.
   */
  productBased?: boolean;
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
  /**
   * Vários produtos escolhidos na tela (filtro "produtos"). Quando presente, restringe a
   * análise a esses códigos — é o modo de uso principal da Projeção de vendas ("mando uma
   * lista de itens e vejo a projeção de cada um"). Convive com os filtros de categoria.
   */
  produtoIds?: string[] | null;
  /**
   * Restringe a PARES produto × cor específicos, no formato "PRODUTO|COR" (código de cor
   * cru). Vem do campo "Colar lista de códigos": código de BARRA identifica a variação, e
   * a análise fica só naquela cor. Um produto colado pelo CÓDIGO DO PRODUTO não entra
   * aqui — vai só em `produtoIds` e abre todas as cores.
   */
  produtoChaves?: string[] | null;
  /** Projeção de vendas: meses da janela do ritmo (termina no último mês com venda). */
  projecaoJanelaMeses?: number | null;
  /**
   * Projeção de vendas: quando true (default), a projeção mensal é limitada pelo estoque
   * atual e zera quando ele acaba. Quando false, mostra a DEMANDA pura do histórico —
   * modo de analisar antes de comprar (item zerado continua mostrando quanto venderia).
   */
  projecaoConsiderarEstoque?: boolean;
  /** Projeção de vendas: aplica índice sazonal por mês (calculado da própria seleção). */
  projecaoSazonalidade?: boolean;
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
  /** Id do grupo de fornecedor (NERD) para filtrar produtos (Externo / Centro / ...). */
  fornecedor?: string | null;
  /**
   * Compra sugerida ABC: quando true, calcula a lente de transferência (reusa a régua do
   * Controle de Transferências, janela 30d) e anexa Disponível p/ transferir, Compra líquida,
   * Custo líquido e "De onde". Opt-in — ligado quando o usuário inclui essas colunas.
   */
  considerarTransferencias?: boolean;
  /**
   * Compra sugerida ABC: quando true, agrega à lista os itens em ruptura (precisa repor e
   * está zerado numa loja, mas o corte de "comprar agora/essa semana" ainda não bateu) que
   * a compra sugerida normal não capturou — nunca duplica. Sem custo extra: reusa o cálculo
   * de Compra Ideal por item×loja já feito.
   */
  incluirRupturas?: boolean;
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
