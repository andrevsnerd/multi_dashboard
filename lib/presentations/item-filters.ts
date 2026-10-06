/**
 * Filtros de ITEM dos decks de coleção (Relatório Completo, Comparativo e
 * Comparativo Resumido): recortam a coleção por atributo do cadastro do produto
 * (PRODUTOS.GRUPO_PRODUTO / SUBGRUPO_PRODUTO / LINHA / GRADE) — ex.: só o subgrupo
 * CETIM DE SEDA da coleção ESSENTIALS.
 *
 * São os MESMOS filtros do Gerador de Relatórios: o recorte é repassado às funções
 * canônicas de venda (`fetchProductsWithDetails`, `fetchSalesTotals`,
 * `fetchTicketItens`), nunca uma conta nova. Módulo sem dependência de servidor —
 * a página e as rotas usam o mesmo tipo e o mesmo normalizador.
 */
export interface PresentationItemFilters {
  grupos?: string[];
  subgrupos?: string[];
  linhas?: string[];
  grades?: string[];
}

export const ITEM_FILTER_KEYS = ["grupos", "subgrupos", "linhas", "grades"] as const;
export type ItemFilterKey = (typeof ITEM_FILTER_KEYS)[number];

const ITEM_FILTER_LABELS: Record<ItemFilterKey, { singular: string; plural: string }> = {
  grupos: { singular: "Grupo", plural: "Grupos" },
  subgrupos: { singular: "Subgrupo", plural: "Subgrupos" },
  linhas: { singular: "Linha", plural: "Linhas" },
  grades: { singular: "Grade", plural: "Grades" },
};

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

/** Lê os filtros de um body/objeto qualquer: só listas de string, trim + upper, sem vazios. */
export function normalizeItemFilters(raw: unknown): PresentationItemFilters {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: PresentationItemFilters = {};
  for (const key of ITEM_FILTER_KEYS) {
    const list = cleanList(src[key]);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

export function hasItemFilters(filtros?: PresentationItemFilters | null): boolean {
  return ITEM_FILTER_KEYS.some((k) => (filtros?.[k]?.length ?? 0) > 0);
}

/**
 * Texto do recorte para o deck ("Subgrupo: CETIM DE SEDA · Linha: LENÇO").
 * null quando não há filtro — o deck mostra a coleção inteira.
 */
export function describeItemFilters(filtros?: PresentationItemFilters | null): string | null {
  const parts = ITEM_FILTER_KEYS.flatMap((k) => {
    const list = filtros?.[k] ?? [];
    if (list.length === 0) return [];
    const label = list.length > 1 ? ITEM_FILTER_LABELS[k].plural : ITEM_FILTER_LABELS[k].singular;
    return [`${label}: ${list.join(", ")}`];
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Acrescenta os filtros numa URLSearchParams (um `append` por valor). */
export function appendItemFilters(params: URLSearchParams, filtros?: PresentationItemFilters | null) {
  for (const key of ITEM_FILTER_KEYS) {
    for (const v of filtros?.[key] ?? []) params.append(key, v);
  }
}

/** Lê os filtros de uma query string (`?subgrupos=A&subgrupos=B`). */
export function itemFiltersFromSearchParams(searchParams: URLSearchParams): PresentationItemFilters {
  const raw: Record<string, string[]> = {};
  for (const key of ITEM_FILTER_KEYS) raw[key] = searchParams.getAll(key);
  return normalizeItemFilters(raw);
}
