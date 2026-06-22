import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const ESTOQUE_REDE_ID = "estoque-por-filial";

/**
 * Catálogo da análise "Estoque por filial". As colunas de filial (Matriz, lojas, ...)
 * são dinâmicas (dependem da empresa) e vêm em `ReportResult.dynamicColumns`.
 * As chaves DEVEM bater com `fetchEstoqueRede` (lib/repositories/reportEstoque.ts).
 */
export const ESTOQUE_REDE_COLUMNS: ReportColumnDef[] = [
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
  { key: "TIPO", defaultLabel: "Tipo", type: "text" },
  { key: "COR", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "ESTOQUE_TOTAL", defaultLabel: "Estoque total", type: "int" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? ESTOQUE_REDE_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

// Preset base (sem as colunas líderes da empresa, que entram em buildEstoqueRedePresets).
const ESTOQUE_REDE_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-estoque-filial",
    name: "Estoque por filial",
    builtin: true,
    sortBy: "ESTOQUE_TOTAL",
    sortDir: "desc",
    // Sempre anexa as colunas por filial (rede inteira) após as fixas.
    dynamicFilialStock: true,
    columns: [col("PRODUTO"), col("COR"), col("DESCRICAO"), col("ESTOQUE_TOTAL")],
  },
  {
    // Estoque por filial + colunas de custo/preço (mestre), parados e cadastro.
    // Permite ver quais produtos estão parados e em quais filiais o estoque está.
    id: "builtin-estoque-parados-filial",
    name: "Parados por filial (custo/preço)",
    builtin: true,
    sortBy: "DIAS_PARADO",
    sortDir: "desc",
    dynamicFilialStock: true,
    columns: [
      col("PRODUTO"),
      col("COR"),
      col("DESCRICAO"),
      col("ESTOQUE_TOTAL"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("CUSTO_TOTAL", "Custo total"),
      col("PRECO_SUGERIDO", "Preço sugerido"),
      col("DIAS_PARADO", "Dias parado"),
      col("ULTIMA_VENDA", "Última venda"),
      col("DATA_CADASTRO", "Data cadastro"),
    ],
  },
];

/** Presets ajustados por empresa: colunas líderes (Grupo / Linha+Subgrupo+Grade) no início. */
export function buildEstoqueRedePresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return ESTOQUE_REDE_PRESETS.map((preset) => ({
    ...preset,
    columns: [...leading, ...preset.columns],
  }));
}

export const estoqueRedeMeta: ReportTypeMeta = {
  id: ESTOQUE_REDE_ID,
  label: "Estoque por filial",
  description:
    "Estoque de todos os produtos (por produto × cor) da rede, com uma coluna por filial e o estoque total. Mesmo escopo da Estoque Consulta (saldos negativos só aparecem quando a filial está totalmente negativa).",
  // Sem período (estoque é o saldo atual) e sem filtro de filial (mostra todas).
  // "diasParado": filtra por defasagem de venda; o backend calcula a defasagem mesmo que
  // a coluna Dias parado não esteja habilitada.
  supportedFilters: ["nome", "cor", "linha", "subgrupo", "grupo", "grade", "tipo", "diasParado"],
  columns: ESTOQUE_REDE_COLUMNS,
  defaultPresets: ESTOQUE_REDE_PRESETS,
};
