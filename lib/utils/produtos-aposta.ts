import type { CompanyKey } from "@/lib/config/company";

export interface ProdutoApostaItem {
  company: CompanyKey;
  produto: string;
  descricao: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeApostaValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildApostaProductKey(produto: string | null | undefined): string {
  return normalizeApostaValue(produto)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

/** Conjunto de chaves de produto aposta, pronto para lookup O(1). */
export function buildApostaKeySet(items: Array<{ produto: string }>): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = buildApostaProductKey(item.produto);
    if (key) set.add(key);
  }
  return set;
}

/** Verifica se um código de produto está marcado como aposta. */
export function isProdutoAposta(keySet: Set<string>, produto: string | null | undefined): boolean {
  const key = buildApostaProductKey(produto);
  return key ? keySet.has(key) : false;
}
