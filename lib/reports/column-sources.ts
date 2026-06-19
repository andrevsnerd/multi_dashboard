import { VENDAS_FATURAMENTO_COLUMNS, VENDAS_FATURAMENTO_ID } from "./vendas-faturamento";
import { ESTOQUE_REDE_COLUMNS, ESTOQUE_REDE_ID } from "./estoque-rede";
import { PRODUTOS_PARADOS_COLUMNS, PRODUTOS_PARADOS_ID } from "./produtos-parados";
import type { ReportColumnDef } from "./types";

/**
 * "Misturar colunas de análises diferentes": cada análise é a BASE (universo de linhas
 * + colunas próprias), e pode receber colunas ESPECÍFICAS de outras fontes como extras,
 * casadas por produto × cor. Aqui ficam o mapa coluna→fonte e os utilitários (puros,
 * usados no client e no server).
 */
export type SourceId = "vendas" | "estoque" | "parados";

/** Fonte nativa de cada tipo de análise (a base já fornece essas colunas). */
export const NATIVE_SOURCE: Record<string, SourceId> = {
  [VENDAS_FATURAMENTO_ID]: "vendas",
  [ESTOQUE_REDE_ID]: "estoque",
  [PRODUTOS_PARADOS_ID]: "parados",
};

/**
 * Colunas (chaves) que cada fonte pode CONTRIBUIR como extra a outra análise.
 * Só colunas específicas da fonte (não atributos compartilhados como Cor/Descrição,
 * que a base já traz) e estáticas (as por filial seguem exclusivas da visão de estoque).
 */
const SOURCE_CROSS_KEYS: Record<SourceId, string[]> = {
  vendas: [
    "QTDE",
    "FATURAMENTO",
    "TICKET_MEDIO",
    "CUSTO_UNITARIO",
    "CUSTO_TOTAL",
    "MARKUP",
    "MARGEM",
    "MARGEM_PERC",
    "PRECO_SUGERIDO",
  ],
  estoque: ["ESTOQUE_TOTAL"],
  parados: ["DIAS_PARADO", "ULTIMA_VENDA"],
};

const ALL_DEFS: Map<string, ReportColumnDef> = (() => {
  const m = new Map<string, ReportColumnDef>();
  for (const c of [
    ...VENDAS_FATURAMENTO_COLUMNS,
    ...ESTOQUE_REDE_COLUMNS,
    ...PRODUTOS_PARADOS_COLUMNS,
  ]) {
    if (!m.has(c.key)) m.set(c.key, c);
  }
  return m;
})();

/** coluna → fonte (só das colunas cross). */
export const columnSource: Record<string, SourceId> = (() => {
  const m: Record<string, SourceId> = {};
  (Object.keys(SOURCE_CROSS_KEYS) as SourceId[]).forEach((src) => {
    for (const k of SOURCE_CROSS_KEYS[src]) m[k] = src;
  });
  return m;
})();

/** Colunas extras (de outras fontes) que o editor deve oferecer para o tipo base. */
export function getEditorExtraColumns(
  reportTypeId: string,
  baseCatalogKeys: Set<string>
): ReportColumnDef[] {
  const native = NATIVE_SOURCE[reportTypeId];
  const out: ReportColumnDef[] = [];
  (Object.keys(SOURCE_CROSS_KEYS) as SourceId[]).forEach((src) => {
    if (src === native) return;
    for (const k of SOURCE_CROSS_KEYS[src]) {
      if (baseCatalogKeys.has(k)) continue; // já existe na base
      const def = ALL_DEFS.get(k);
      if (def) out.push(def);
    }
  });
  return out;
}

/** Fontes extras a buscar dado o conjunto de colunas habilitadas. */
export function computeExtraSources(
  reportTypeId: string,
  enabledKeys: string[],
  baseCatalogKeys: Set<string>
): SourceId[] {
  const native = NATIVE_SOURCE[reportTypeId];
  const needed = new Set<SourceId>();
  for (const k of enabledKeys) {
    if (baseCatalogKeys.has(k)) continue; // nativa da base
    const src = columnSource[k];
    if (src && src !== native) needed.add(src);
  }
  return Array.from(needed);
}

/** Conjunto de chaves de colunas cross (para validar/sanitizar presets). */
export const CROSS_COLUMN_KEYS: Set<string> = new Set(Object.keys(columnSource));
