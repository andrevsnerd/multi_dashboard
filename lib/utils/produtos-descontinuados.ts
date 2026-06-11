import type { CompanyKey } from "@/lib/config/company";

export interface ProdutoDescontinuadoItem {
  company: CompanyKey;
  produto: string;
  descricao: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeDescontinuadoValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildDescontinuadoProductKey(produto: string | null | undefined): string {
  return normalizeDescontinuadoValue(produto)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

/** Conjunto de chaves de produto descontinuado, pronto para lookup O(1). */
export function buildDescontinuadoKeySet(
  items: Array<{ produto: string }>
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = buildDescontinuadoProductKey(item.produto);
    if (key) set.add(key);
  }
  return set;
}

/** Verifica se um código de produto está marcado como descontinuado. */
export function isProdutoDescontinuado(
  keySet: Set<string>,
  produto: string | null | undefined
): boolean {
  const key = buildDescontinuadoProductKey(produto);
  return key ? keySet.has(key) : false;
}
