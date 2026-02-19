/**
 * Cache em memória para resultado de fetchCategoriasComGiro (CTE pesada).
 * TTL 5 minutos — evita re-executar a mesma query quando os mesmos parâmetros
 * são pedidos dentro de 5 minutos.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutos

export interface GiroCacheEntry {
  chaves: Set<string>;
  produtosPorChave: Map<string, string[]>;
  todosProdutos: Set<string>;
  expiresAt: number;
}

const cache = new Map<string, GiroCacheEntry>();

function cacheKey(params: {
  company?: string;
  filial?: string | null;
  grupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  diasGiro: number;
}): string {
  const parts = [
    params.company ?? '',
    params.filial ?? '',
    (params.grupos ?? []).slice().sort().join(','),
    (params.linhas ?? []).slice().sort().join(','),
    (params.colecoes ?? []).slice().sort().join(','),
    (params.subgrupos ?? []).slice().sort().join(','),
    (params.grades ?? []).slice().sort().join(','),
    String(params.diasGiro),
  ];
  return parts.join('|');
}

export function getGiroCache(params: Parameters<typeof cacheKey>[0]): GiroCacheEntry | null {
  const key = cacheKey(params);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setGiroCache(
  params: Parameters<typeof cacheKey>[0],
  value: Omit<GiroCacheEntry, 'expiresAt'>
): void {
  const key = cacheKey(params);
  cache.set(key, {
    ...value,
    expiresAt: Date.now() + TTL_MS,
  });
}
