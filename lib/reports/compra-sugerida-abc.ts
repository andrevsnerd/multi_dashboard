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
  { key: "ESTOQUE_REDE", defaultLabel: "Estoque rede", type: "int" },
  { key: "COMPRA_TOTAL", defaultLabel: "Compra total", type: "int" },
  { key: "CUSTO_TOTAL", defaultLabel: "Custo total", type: "currency" },
  // Lente de transferência (opt-in): incluir qualquer uma destas colunas liga o cálculo
  // (reusa a régua do Controle de Transferências, janela 30d). Fora do preset padrão →
  // o export continua idêntico até você adicionar a coluna.
  { key: "TRANSFERIVEL", defaultLabel: "Disponível p/ transferir", type: "int" },
  { key: "COMPRA_LIQUIDA", defaultLabel: "Compra líquida (após transferir)", type: "int" },
  { key: "CUSTO_LIQUIDO", defaultLabel: "Custo líquido", type: "currency" },
  { key: "TRANSFERIR_DE", defaultLabel: "Transferir de", type: "text" },
];

/** Colunas que, se selecionadas, ligam a lente de transferência no backend. */
export const COMPRA_TRANSFER_LENS_COLUMNS = [
  "TRANSFERIVEL",
  "COMPRA_LIQUIDA",
  "CUSTO_LIQUIDO",
  "TRANSFERIR_DE",
] as const;

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
    // Identidade do item → custo unitário → estoque rede → Compra total → Custo total. As
    // colunas por loja (Compra sugerida de cada filial) são anexadas automaticamente APÓS
    // estas, ao gerar. Sem Curva/Código: o export agrupa por categoria (Grupo/Linha) com
    // faixas — a classificação ABC não é o critério de organização visual do arquivo.
    columns: [
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("ESTOQUE_REDE", "Estoque rede"),
      col("COMPRA_TOTAL", "Compra total"),
      col("CUSTO_TOTAL", "Custo total"),
      // Lente de transferência (Transferência + Compra líquida) fica FORA do padrão — entra
      // só pelo checkbox "Considerar transferências" no Gerador (ver COMPRA_LENS_PRESET_COLUMNS).
    ],
  },
  {
    id: "builtin-compra-sugerida-rupturas",
    name: "Compra sugerida (agora + essa semana) + Rupturas",
    builtin: true,
    sortBy: "COMPRA_TOTAL",
    sortDir: "desc",
    // Mesmas colunas do preset normal — os itens de ruptura entram nas mesmas linhas/colunas,
    // com fundo rosa no XLSX (ver ROW_RUPTURA_FIELD) pra diferenciar de onde cada um veio.
    columns: [
      col("COR_DESCRICAO"),
      col("DESCRICAO"),
      col("CUSTO_UNITARIO", "Custo unit."),
      col("ESTOQUE_REDE", "Estoque rede"),
      col("COMPRA_TOTAL", "Compra total"),
      col("CUSTO_TOTAL", "Custo total"),
    ],
    incluirRupturas: true,
  },
];

/**
 * Colunas anexadas ao preset quando o usuário liga a lente de transferência no Gerador
 * (checkbox opcional, desligado por padrão). Ordem/labels iguais aos do antigo padrão.
 */
export const COMPRA_LENS_PRESET_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "TRANSFERIR_DE", label: "Transferência" },
  { key: "COMPRA_LIQUIDA", label: "Compra líquida" },
];

/**
 * Presets padrão por empresa: colunas líderes (Grupo / Linha+Subgrupo…) em 1º — a primeira
 * delas é a categoria usada para agrupar o export em blocos com faixa —, resto na sequência.
 */
export function buildCompraSugeridaAbcPresets(companyKey: CompanyKey): ReportPresetDef[] {
  const leading = companyLeadingColumns(companyKey);
  return COMPRA_SUGERIDA_ABC_PRESETS.map((preset) => ({
    ...preset,
    columns: [...leading, ...preset.columns],
  }));
}

export const compraSugeridaAbcMeta: ReportTypeMeta = {
  id: COMPRA_SUGERIDA_ABC_ID,
  label: "Compra sugerida por Curva ABC",
  fileSlug: "compra-sugerida",
  description:
    "Lista de compras consolidada da rede: para cada item da Curva ABC, traz a compra sugerida de CADA loja (só o que precisa comprar agora ou comprar essa semana). Uma coluna por loja; a Compra total e o Custo total são fórmulas dinâmicas no Excel — altere as quantidades das lojas e os totais se recalculam.",
  // Sem filtro de filial: o relatório é sempre da rede inteira (uma coluna por loja).
  supportedFilters: ["periodo", "nome", "linha", "subgrupo", "grupo", "grade", "colecao", "tipo"],
  columns: COMPRA_SUGERIDA_ABC_COLUMNS,
  defaultPresets: COMPRA_SUGERIDA_ABC_PRESETS,
};
