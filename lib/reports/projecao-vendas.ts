import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const PROJECAO_VENDAS_ID = "projecao-vendas";

/**
 * Prefixo das chaves das colunas dinâmicas de mês projetado (`PROJECAO_MES::2026-08`).
 * Espelhado no front (strip entre gerações) e no exportador XLSX (que desenha a faixa
 * "Projeção mensal" acima desse bloco de colunas).
 */
export const PROJECAO_MES_COL_PREFIX = "PROJECAO_MES::";

/** Horizonte máximo de colunas de mês (decisão do dono: até acabar, teto de 12 meses). */
export const PROJECAO_HORIZONTE_MESES = 12;

/** Quantos meses de série mensal buscar para medir o ritmo (e a sazonalidade). */
export const PROJECAO_LOOKBACK_MESES = 24;

/** Janelas de ritmo oferecidas na tela (meses que terminam na âncora). Default 3. */
export const PROJECAO_JANELAS_MESES = [2, 3, 6] as const;
export const PROJECAO_JANELA_DEFAULT = 3;

/**
 * Sentinelas da coluna "Dias p/ acabar" — ambas ordenam no FIM (ascendente mostra
 * primeiro quem acaba mais rápido, que é a leitura útil).
 */
export const DIAS_ACABAR_EXCEDE = 9999;
export const DIAS_ACABAR_SEM_GIRO = 99999;

/**
 * Catálogo de colunas da análise "Projeção de vendas". As chaves DEVEM bater com as
 * produzidas em `fetchProjecaoVendas` ([lib/repositories/reportProjecaoVendas.ts]).
 * As colunas de mês são dinâmicas (dependem de quando o estoque acaba) e vêm em
 * `ReportResult.dynamicColumns` com o prefixo acima.
 */
export const PROJECAO_VENDAS_COLUMNS: ReportColumnDef[] = [
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "COR", defaultLabel: "Cor (cód.)", type: "text" },
  { key: "COR_DESCRICAO", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "TIPO", defaultLabel: "Tipo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
  // ── Situação de estoque ──
  { key: "ESTOQUE_REDE", defaultLabel: "Estoque atual", type: "int" },
  { key: "CUSTO_UNITARIO", defaultLabel: "Custo unit.", type: "currency" },
  { key: "VALOR_ESTOQUE", defaultLabel: "Valor do estoque", type: "currency" },
  // ── Ritmo estimado e sua procedência (o "mostre o seu trabalho" da projeção) ──
  { key: "RITMO_MES", defaultLabel: "Ritmo (un/mês)", type: "number" },
  { key: "RITMO_DIA", defaultLabel: "Ritmo (un/dia)", type: "number" },
  { key: "BASE_RITMO", defaultLabel: "Base do ritmo", type: "text" },
  { key: "BASE_MESES", defaultLabel: "Meses na base", type: "int" },
  { key: "BASE_QTDE", defaultLabel: "Un. na base", type: "int" },
  // Idade da base: quantos meses fechados se passaram depois do último mês da janela.
  // 0 = ritmo do mês passado; alto = ritmo veio de um período antigo (mesmo que o item
  // tenha voltado a vender agora — vendedor esparso).
  { key: "BASE_IDADE_MESES", defaultLabel: "Idade da base (meses)", type: "int" },
  { key: "ORIGEM_RITMO", defaultLabel: "Origem do ritmo", type: "text" },
  { key: "CONFIANCA", defaultLabel: "Confiança", type: "text" },
  { key: "ULTIMA_VENDA_MES", defaultLabel: "Última venda", type: "text" },
  { key: "MESES_PARADO", defaultLabel: "Parado há (meses)", type: "int" },
  { key: "QTDE_3M", defaultLabel: "Vendido 3 meses", type: "int" },
  { key: "QTDE_12M", defaultLabel: "Vendido 12 meses", type: "int" },
  // ── Resultado da projeção ──
  { key: "COBERTURA_MESES", defaultLabel: "Cobertura (meses)", type: "number" },
  { key: "DIAS_PARA_ACABAR", defaultLabel: "Dias p/ acabar", type: "diasAcabar" },
  { key: "DATA_ACABA", defaultLabel: "Acaba em", type: "date" },
  { key: "PROJECAO_TOTAL", defaultLabel: "Projeção total (un)", type: "int" },
  { key: "SOBRA_HORIZONTE", defaultLabel: "Sobra no horizonte", type: "int" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? PROJECAO_VENDAS_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const PROJECAO_VENDAS_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-projecao-vendas",
    name: "Projeção de vendas",
    builtin: true,
    // Quem acaba mais rápido primeiro — é a leitura de urgência da tabela. As sentinelas
    // ("Sem giro" / "Mais de 12 meses") ficam no fim por construção.
    sortBy: "DIAS_PARA_ACABAR",
    sortDir: "asc",
    columns: [
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("ESTOQUE_REDE"),
      col("RITMO_MES"),
      col("ULTIMA_VENDA_MES"),
      col("MESES_PARADO"),
      col("CONFIANCA"),
      col("DIAS_PARA_ACABAR"),
      col("DATA_ACABA"),
      // As colunas de mês (ago/26, set/26, …) são anexadas automaticamente APÓS estas.
    ],
  },
  {
    id: "builtin-projecao-vendas-auditoria",
    name: "Projeção + base do cálculo",
    builtin: true,
    sortBy: "DIAS_PARA_ACABAR",
    sortDir: "asc",
    // Mesma projeção, mas com a procedência do ritmo aberta ao lado — para conferir de
    // onde saiu cada número antes de decidir compra.
    columns: [
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("ESTOQUE_REDE"),
      col("VALOR_ESTOQUE"),
      col("QTDE_3M"),
      col("QTDE_12M"),
      col("RITMO_MES"),
      col("BASE_RITMO"),
      col("BASE_QTDE"),
      col("BASE_IDADE_MESES"),
      col("ORIGEM_RITMO"),
      col("CONFIANCA"),
      col("ULTIMA_VENDA_MES"),
      col("MESES_PARADO"),
      col("COBERTURA_MESES"),
      col("DIAS_PARA_ACABAR"),
      col("DATA_ACABA"),
      col("PROJECAO_TOTAL"),
      col("SOBRA_HORIZONTE"),
    ],
  },
];

/** Presets padrão por empresa: colunas líderes (Grupo / Linha+Subgrupo…) na frente. */
export function buildProjecaoVendasPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return PROJECAO_VENDAS_PRESETS.map((preset) => ({
    ...preset,
    columns: [...leading, ...preset.columns],
  }));
}

export const projecaoVendasMeta: ReportTypeMeta = {
  id: PROJECAO_VENDAS_ID,
  label: "Projeção de vendas",
  description:
    "Quanto cada item (produto × cor) deve vender no mês atual e nos próximos, consumindo o estoque de hoje até acabar — uma coluna por mês, mais os dias até zerar. O ritmo vem da série MENSAL de vendas dos últimos 24 meses, medido na janela que termina no último mês com venda: item ativo usa os meses recentes, item que parou usa os meses em que vendia (e o relatório mostra há quanto tempo parou e a confiança da estimativa). Nenhuma reconstrução de estoque retroativo entra na conta.",
  // Sem "periodo": o ritmo é sempre medido nos últimos 24 meses e a projeção começa no mês
  // corrente — um período escolhido na tela só confundiria (não muda nada no cálculo).
  supportedFilters: [
    "produtos",
    "filial",
    "nome",
    "cor",
    "linha",
    "subgrupo",
    "grupo",
    "grade",
    "colecao",
    "tipo",
    "projecao",
  ],
  columns: PROJECAO_VENDAS_COLUMNS,
  defaultPresets: PROJECAO_VENDAS_PRESETS,
};
