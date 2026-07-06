import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const CLIENTES_FILIAL_ID = "clientes-filial";

/** Prefixo das chaves das colunas dinâmicas de tickets por filial (espelha o backend/front). */
export const FILIAL_COMPRAS_COL_PREFIX = "FILIAL_COMPRAS::";

/**
 * Catálogo da análise "Clientes por Filial". As chaves DEVEM bater com
 * `fetchClientesFilial` (lib/repositories/reportClientesFilial.ts). Uma linha por
 * cliente (nome), com atributos vindos do cadastro (CLIENTES_VAREJO) e as métricas
 * de compra no período. As colunas por filial (nº de tickets) são dinâmicas.
 */
export const CLIENTES_FILIAL_COLUMNS: ReportColumnDef[] = [
  { key: "CPF", defaultLabel: "CPF", type: "text" },
  { key: "CLIENTE", defaultLabel: "Cliente", type: "text" },
  { key: "TOTAL_GASTO", defaultLabel: "Total gasto", type: "currency" },
  { key: "PECAS", defaultLabel: "Peças", type: "int" },
  { key: "TICKETS", defaultLabel: "Tickets", type: "int" },
  { key: "PRIMEIRA_COMPRA", defaultLabel: "1ª compra", type: "date" },
  { key: "ULTIMA_COMPRA", defaultLabel: "Última compra", type: "date" },
  { key: "CIDADE", defaultLabel: "Cidade", type: "text" },
  { key: "ENDERECO", defaultLabel: "Endereço", type: "text" },
  { key: "TELEFONE", defaultLabel: "Telefone", type: "text" },
];

const col = (key: string, label?: string) => ({
  key,
  label: label ?? CLIENTES_FILIAL_COLUMNS.find((c) => c.key === key)?.defaultLabel ?? key,
});

const CLIENTES_FILIAL_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-clientes-filial",
    name: "Clientes por filial",
    builtin: true,
    sortBy: "TOTAL_GASTO",
    sortDir: "desc",
    columns: [
      col("CPF"),
      col("CLIENTE"),
      col("TOTAL_GASTO"),
      col("PECAS"),
      col("TICKETS"),
      col("PRIMEIRA_COMPRA"),
      col("ULTIMA_COMPRA"),
      col("CIDADE"),
      col("ENDERECO"),
      col("TELEFONE"),
    ],
    // As colunas de tickets por filial são anexadas dinamicamente ao fim, uma por filial.
  },
];

export function buildClientesFilialPresets(): ReportPresetDef[] {
  return CLIENTES_FILIAL_PRESETS;
}

export const clientesFilialMeta: ReportTypeMeta = {
  id: CLIENTES_FILIAL_ID,
  label: "Clientes por filial",
  description:
    "Relação de clientes que compraram no período: total gasto, peças, tickets, 1ª e última compra, cidade, endereço e telefone — com uma coluna por filial mostrando quantos tickets o cliente fez em cada uma. Agrupa por cliente (nome); CPF/cidade/endereço/telefone vêm do cadastro.",
  supportedFilters: ["periodo", "filial"],
  columns: CLIENTES_FILIAL_COLUMNS,
  defaultPresets: CLIENTES_FILIAL_PRESETS,
  // Análise por CLIENTE (não produto × cor): fora do "misturar colunas" e sem a coluna
  // dinâmica "Código de barra" que o runReport anexa às análises de produto.
  productBased: false,
};
