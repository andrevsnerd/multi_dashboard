import type { CompanyKey } from "@/lib/config/company";
import { companyLeadingColumns } from "./company-columns";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const PRODUTOS_CADASTRO_ID = "produtos-cadastro";

/**
 * Catálogo da análise "Produtos por cadastro". As chaves DEVEM bater com
 * `fetchProdutosCadastro` (lib/repositories/reportProdutosCadastro.ts).
 */
export const PRODUTOS_CADASTRO_COLUMNS: ReportColumnDef[] = [
  { key: "DATA_CADASTRO", defaultLabel: "Data cadastro", type: "date" },
  { key: "DIAS_CADASTRO", defaultLabel: "Dias cadastro", type: "int" },
  { key: "PRODUTO", defaultLabel: "Código", type: "text" },
  { key: "GRUPO", defaultLabel: "Grupo", type: "text" },
  { key: "LINHA", defaultLabel: "Linha", type: "text" },
  { key: "SUBGRUPO", defaultLabel: "Subgrupo", type: "text" },
  { key: "GRADE", defaultLabel: "Grade", type: "text" },
  { key: "COLECAO", defaultLabel: "Coleção", type: "text" },
  { key: "TIPO", defaultLabel: "Tipo", type: "text" },
  { key: "COR", defaultLabel: "Cor", type: "text" },
  { key: "DESCRICAO", defaultLabel: "Descrição", type: "text" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? PRODUTOS_CADASTRO_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

// Preset base (sem as colunas líderes da empresa, inseridas em buildProdutosCadastroPresets).
const PRODUTOS_CADASTRO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-produtos-cadastro",
    name: "Produtos por cadastro",
    builtin: true,
    sortBy: "DATA_CADASTRO",
    sortDir: "desc",
    columns: [
      col("DATA_CADASTRO"),
      col("PRODUTO"),
      col("COR"),
      col("DESCRICAO"),
      col("DIAS_CADASTRO"),
    ],
  },
];

/**
 * Presets por empresa: a "Data cadastro" fica em 1º; as colunas líderes (Grupo /
 * Linha+Subgrupo+Grade) entram LOGO DEPOIS dela. "Dias cadastro" já está após a descrição.
 */
export function buildProdutosCadastroPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return PRODUTOS_CADASTRO_PRESETS.map((preset) => ({
    ...preset,
    columns: [preset.columns[0], ...leading, ...preset.columns.slice(1)],
  }));
}

export const produtosCadastroMeta: ReportTypeMeta = {
  id: PRODUTOS_CADASTRO_ID,
  label: "Produtos por cadastro",
  fileSlug: "cadastro",
  description:
    "Produtos (por produto × cor, com estoque) com a data de cadastro e há quantos dias foram cadastrados. Útil para achar itens novos ou antigos. Mesmo escopo da Estoque por filial.",
  supportedFilters: ["filial", "nome", "cor", "linha", "subgrupo", "grupo", "grade"],
  columns: PRODUTOS_CADASTRO_COLUMNS,
  defaultPresets: PRODUTOS_CADASTRO_PRESETS,
};
