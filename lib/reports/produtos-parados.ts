import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const PRODUTOS_PARADOS_ID = "produtos-parados";

/**
 * Catálogo da análise "Produtos Parados". As chaves DEVEM bater com
 * `fetchProdutosParados` (lib/repositories/reportProdutosParados.ts).
 */
export const PRODUTOS_PARADOS_COLUMNS: ReportColumnDef[] = [
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "CODIGO_BARRA", defaultLabel: "Cód. barra", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
  { key: "COR", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
  { key: "ESTOQUE", defaultLabel: "Estoque", type: "int" },
  { key: "DIAS_PARADO", defaultLabel: "Dias parado", type: "diasParado" },
  { key: "ULTIMA_VENDA", defaultLabel: "Última venda", type: "dataVenda" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? PRODUTOS_PARADOS_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

// Preset base (sem as colunas líderes da empresa, que entram em buildProdutosParadosPresets).
const PRODUTOS_PARADOS_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-produtos-parados",
    name: "Produtos parados",
    builtin: true,
    sortBy: "DIAS_PARADO",
    sortDir: "desc",
    columns: [
      col("PRODUTO"),
      col("COR"),
      col("DESCRICAO"),
      col("ESTOQUE"),
      col("DIAS_PARADO"),
      col("ULTIMA_VENDA"),
    ],
  },
];

/** Presets ajustados por empresa: colunas líderes (Grupo / Linha+Subgrupo+Grade) no início. */
export function buildProdutosParadosPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return PRODUTOS_PARADOS_PRESETS.map((preset) => ({
    ...preset,
    columns: [...leading, ...preset.columns],
  }));
}

export const produtosParadosMeta: ReportTypeMeta = {
  id: PRODUTOS_PARADOS_ID,
  label: "Produtos parados",
  description:
    "Produtos (por produto × cor) com estoque, mostrando há quantos dias estão sem vender (ou \"Nunca vendeu\") e a data da última venda. Mesma lógica da página Produtos Parados; ordene por Dias parado para ver os mais parados primeiro.",
  // Sem período (a defasagem é calculada até hoje).
  supportedFilters: ["filial", "nome", "cor", "linha", "subgrupo", "grupo", "grade"],
  columns: PRODUTOS_PARADOS_COLUMNS,
  defaultPresets: PRODUTOS_PARADOS_PRESETS,
};
