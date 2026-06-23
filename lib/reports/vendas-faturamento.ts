import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const VENDAS_FATURAMENTO_ID = "vendas-faturamento";

/**
 * Catálogo completo de colunas da análise "Vendas por faturamento".
 * As chaves DEVEM bater com as chaves produzidas em
 * `fetchVendasFaturamento` (lib/repositories/reportVendas.ts).
 */
export const VENDAS_FATURAMENTO_COLUMNS: ReportColumnDef[] = [
  { key: "CURVA", defaultLabel: "Curva", type: "text" },
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
  { key: "QTDE", defaultLabel: "Qtde", type: "int" },
  { key: "PROJECAO_QTD_MES", defaultLabel: "Projeção qtd mês", type: "int" },
  { key: "ESTOQUE_FINAL_MES", defaultLabel: "Estoque final mês", type: "int" },
  { key: "DURACAO_ESTOQUE", defaultLabel: "Duração estoque (dias)", type: "int" },
  { key: "FATURAMENTO", defaultLabel: "Faturamento", type: "currency" },
  { key: "TICKET_MEDIO", defaultLabel: "Preço médio", type: "currency" },
  { key: "CUSTO_UNITARIO", defaultLabel: "Custo unit.", type: "currency" },
  { key: "CUSTO_TOTAL", defaultLabel: "Custo total", type: "currency" },
  { key: "MARKUP", defaultLabel: "Markup", type: "number" },
  { key: "MARGEM", defaultLabel: "Margem (R$)", type: "currency" },
  { key: "MARGEM_PERC", defaultLabel: "Margem (%)", type: "percent" },
  { key: "ESTOQUE", defaultLabel: "Estoque", type: "int" },
  { key: "ESTOQUE_TOTAL", defaultLabel: "Estoque total", type: "int" },
  { key: "PRECO_SUGERIDO", defaultLabel: "Preço sugerido", type: "currency" },
  { key: "PARTICIPACAO_PERC", defaultLabel: "Part. (%)", type: "percent" },
  { key: "PARTICIPACAO_ACUM_PERC", defaultLabel: "Part. acum. (%)", type: "percent" },
  { key: "COMPRA_IDEAL", defaultLabel: "Compra ideal", type: "int" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? VENDAS_FATURAMENTO_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const VENDAS_FATURAMENTO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-faturamento",
    name: "Faturamento (padrão)",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("TICKET_MEDIO", "Preço médio"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("MARKUP"),
      col("ESTOQUE"),
    ],
  },
  {
    id: "builtin-curva-abc",
    name: "Curva ABC",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    // Igual ao preset de faturamento, com a coluna Curva (A/B/C) em primeiro.
    // Regra dos 60%/90% por faturamento acumulado (mesma da tela de Curva ABC).
    columns: [
      col("CURVA"),
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("TICKET_MEDIO", "Preço médio"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("MARKUP"),
      col("ESTOQUE"),
    ],
  },
  {
    id: "builtin-margem",
    name: "Margem",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("CUSTO_TOTAL"),
      col("MARGEM"),
      col("MARGEM_PERC"),
      col("MARKUP"),
    ],
  },
  {
    id: "builtin-faturamento-estoque",
    name: "Faturamento com estoque",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    // Visão focada em estoque: além das colunas fixas, anexa uma coluna por filial
    // (rede inteira) automaticamente — ver `dynamicFilialStock`.
    dynamicFilialStock: true,
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("ESTOQUE_TOTAL"),
    ],
  },
  {
    id: "builtin-vendas-estoque-filiais",
    name: "Vendas + estoque por filial",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    // Cada item vendido seguido de TODAS as colunas de estoque por filial (rede inteira),
    // anexadas automaticamente após as fixas — ver `dynamicFilialStock`.
    dynamicFilialStock: true,
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("TICKET_MEDIO", "Preço médio"),
      col("ESTOQUE_TOTAL"),
    ],
  },
  {
    id: "builtin-vendas-estoque-por-filial",
    name: "Vendas por filial + estoque por filial",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    // Para cada filial da rede, intercala duas colunas: "{filial} Venda" (qtde vendida
    // no período) e "{filial} Estoque" — anexadas após as fixas. Ver `dynamicFilialStock`
    // + `dynamicFilialSales` (backend monta as colunas intercaladas por filial).
    dynamicFilialStock: true,
    dynamicFilialSales: true,
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO", "Venda Líquida"),
      col("TICKET_MEDIO", "Preço médio"),
      col("ESTOQUE_TOTAL"),
    ],
  },
  {
    id: "builtin-projecao-estoque",
    name: "Projeção e estoque",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("PROJECAO_QTD_MES"),
      col("ESTOQUE_FINAL_MES"),
      col("ESTOQUE"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("TICKET_MEDIO", "Preço médio"),
      col("PRECO_SUGERIDO"),
      col("DURACAO_ESTOQUE"),
    ],
  },
  {
    id: "builtin-curva-compra",
    name: "Curva com sugestão de compra",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    // Igual à Curva ABC + Compra ideal no fim (mesma lógica de lista loja / curva ABC).
    columns: [
      col("CURVA"),
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("QTDE"),
      col("FATURAMENTO"),
      col("ESTOQUE"),
      col("COMPRA_IDEAL"),
    ],
  },
  {
    id: "builtin-completo",
    name: "Completo",
    builtin: true,
    sortBy: "FATURAMENTO",
    sortDir: "desc",
    columns: VENDAS_FATURAMENTO_COLUMNS.map((c) => col(c.key)),
  },
];

// Presets que recebem as colunas líderes logo no INÍCIO.
const PRESETS_LEADING_AT_START = new Set([
  "builtin-faturamento",
  "builtin-faturamento-estoque",
  "builtin-vendas-estoque-filiais",
  "builtin-vendas-estoque-por-filial",
  "builtin-projecao-estoque",
]);

/**
 * Presets padrão da análise, ajustados por empresa: as colunas líderes entram no
 * começo dos presets de faturamento e logo APÓS a coluna "Curva" no preset Curva ABC.
 */
export function buildVendasFaturamentoPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return VENDAS_FATURAMENTO_PRESETS.map((preset) => {
    if (PRESETS_LEADING_AT_START.has(preset.id)) {
      return { ...preset, columns: [...leading, ...preset.columns] };
    }
    if (preset.id === "builtin-curva-abc" || preset.id === "builtin-curva-compra") {
      // Mantém CURVA em 1º; insere as colunas líderes logo depois.
      return { ...preset, columns: [preset.columns[0], ...leading, ...preset.columns.slice(1)] };
    }
    return preset;
  });
}

export const vendasFaturamentoMeta: ReportTypeMeta = {
  id: VENDAS_FATURAMENTO_ID,
  label: "Vendas por faturamento",
  description:
    "Itens vendidos no período (por produto × cor), ordenados por faturamento líquido. Usa a mesma lógica validada da tela de Produtos (trocas, cancelamentos e descontos já tratados).",
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
  columns: VENDAS_FATURAMENTO_COLUMNS,
  defaultPresets: VENDAS_FATURAMENTO_PRESETS,
};
