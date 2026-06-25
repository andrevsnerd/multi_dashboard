import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const COMPRA_SUGERIDA_ABC_ID = "compra-sugerida-abc";

/**
 * Prefixo das chaves das colunas dinâmicas de compra sugerida por filial. Espelhado no
 * front (strip entre gerações) e no exportador XLSX (detecta as colunas das lojas para
 * montar a fórmula de Compra total). Uma coluna por loja, na ordem de exibição da rede.
 */
export const COMPRA_FILIAL_COL_PREFIX = "COMPRA_FILIAL::";

/**
 * Catálogo de colunas da análise "Compra sugerida por Curva ABC".
 * As chaves DEVEM bater com as produzidas em `fetchCompraSugeridaAbc`
 * (lib/repositories/reportCompraSugeridaAbc.ts). As colunas por loja são dinâmicas
 * (dependem da rede) e vêm em `ReportResult.dynamicColumns` com o prefixo acima.
 */
export const COMPRA_SUGERIDA_ABC_COLUMNS: ReportColumnDef[] = [
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
  { key: "CUSTO_UNITARIO", defaultLabel: "Custo unit.", type: "currency" },
  { key: "COMPRA_TOTAL", defaultLabel: "Compra total", type: "int" },
  { key: "CUSTO_TOTAL", defaultLabel: "Custo total", type: "currency" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? COMPRA_SUGERIDA_ABC_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const COMPRA_SUGERIDA_ABC_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-compra-sugerida",
    name: "Compra sugerida (agora + essa semana)",
    builtin: true,
    sortBy: "COMPRA_TOTAL",
    sortDir: "desc",
    // Identidade do item → custo unitário → Compra total → Custo total. As colunas por loja
    // (Compra sugerida de cada filial) são anexadas automaticamente APÓS estas, ao gerar.
    columns: [
      col("CURVA"),
      col("PRODUTO"),
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("COMPRA_TOTAL", "Compra total"),
      col("CUSTO_TOTAL", "Custo total"),
    ],
  },
];

/**
 * Presets padrão por empresa: CURVA em 1º, colunas líderes (Grupo / Linha+Subgrupo…) logo
 * após, e o resto na sequência — mesma convenção do preset Curva ABC de vendas-faturamento.
 */
export function buildCompraSugeridaAbcPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return COMPRA_SUGERIDA_ABC_PRESETS.map((preset) => ({
    ...preset,
    columns: [preset.columns[0], ...leading, ...preset.columns.slice(1)],
  }));
}

export const compraSugeridaAbcMeta: ReportTypeMeta = {
  id: COMPRA_SUGERIDA_ABC_ID,
  label: "Compra sugerida por Curva ABC",
  description:
    "Lista de compras consolidada da rede: para cada item da Curva ABC, traz a compra sugerida de CADA loja (só o que precisa comprar agora ou comprar essa semana). Uma coluna por loja; a Compra total e o Custo total são fórmulas dinâmicas no Excel — altere as quantidades das lojas e os totais se recalculam.",
  // Sem filtro de filial: o relatório é sempre da rede inteira (uma coluna por loja).
  supportedFilters: ["periodo", "nome", "linha", "subgrupo", "grupo", "grade", "colecao", "tipo"],
  columns: COMPRA_SUGERIDA_ABC_COLUMNS,
  defaultPresets: COMPRA_SUGERIDA_ABC_PRESETS,
};
