import 'server-only';

import { query } from '@/lib/db/connection';
import { FILIAIS, getFilialById, type FilialDef } from '@/lib/config/filial-registry';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RESOLVER DE FILIAIS — traduz COD_FILIAL (ID estável) ⇄ nome vivo do banco.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * O registry (`filial-registry.ts`) define cada filial pelo seu ID. As tabelas
 * operacionais (ESTOQUE_PRODUTOS, FATURAMENTO, VENDAS_PRODUTO, ...) filtram pelo
 * NOME. Este módulo busca o nome atual na tabela FILIAIS pelo ID, com cache, de
 * forma que um rename no ERP se reflita automaticamente — sem editar config.
 *
 * Se o ERP estiver indisponível, cai no `dbNameFallback` do registry.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

interface NameCache {
  /** normId -> nome vivo no banco */
  idToName: Map<string, string>;
  /** chave normalizada de nome -> id (COD_FILIAL canônico do registry) */
  normNameToId: Map<string, string>;
  expiresAt: number;
}

let cache: NameCache | null = null;

/** Normaliza nome de filial para casamento tolerante (espaços, hífens unicode, acento). */
export function normalizeFilialNameKey(s: string): string {
  return String(s ?? '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Match contra o banco é SEMPRE por COD_FILIAL exato (string trim), pois o ERP
// tem códigos colidentes sob normalização — ex.: registry '001' (MATRIZ) vs
// banco '00001' (CIDADE JARDIM, fora do registry) ambos virariam '1'.
const REGISTRY_EXACT_IDS = new Map(FILIAIS.map((f) => [f.id.trim(), f]));

/** ID exato do registry para um input de chamador interno (tolera '116' p/ '000116'). */
function toRegistryId(input: string | number): string | null {
  return getFilialById(input)?.id ?? null;
}

function buildFallbackCache(): NameCache {
  const idToName = new Map<string, string>();
  const normNameToId = new Map<string, string>();
  for (const f of FILIAIS) {
    idToName.set(f.id, f.dbNameFallback);
    normNameToId.set(normalizeFilialNameKey(f.dbNameFallback), f.id);
  }
  return { idToName, normNameToId, expiresAt: 0 }; // expiresAt 0 = nunca cacheia o fallback
}

/**
 * Carrega (com cache) o mapa COD_FILIAL ⇄ nome a partir da tabela FILIAIS do ERP.
 * Restringe-se aos IDs presentes no registry — as demais filiais do ERP não nos
 * interessam aqui. Chave = COD_FILIAL exato do registry.
 */
async function loadCache(): Promise<NameCache> {
  if (cache && cache.expiresAt > Date.now()) return cache;

  try {
    const rows = await query<{ COD_FILIAL: string | null; FILIAL: string | null }>(`
      SELECT
        RTRIM(LTRIM(CAST(COD_FILIAL AS VARCHAR(50)))) AS COD_FILIAL,
        RTRIM(LTRIM(FILIAL))                          AS FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE FILIAL IS NOT NULL
    `);

    const idToName = new Map<string, string>();
    const normNameToId = new Map<string, string>();

    // Começa do fallback do registry e sobrescreve com o nome vivo quando existir.
    for (const f of FILIAIS) {
      idToName.set(f.id, f.dbNameFallback);
    }

    for (const r of rows) {
      const cod = (r.COD_FILIAL ?? '').trim();
      const nome = (r.FILIAL ?? '').trim();
      if (!cod || !nome) continue;
      if (!REGISTRY_EXACT_IDS.has(cod)) continue; // só filiais do registry, match exato
      idToName.set(cod, nome);
    }

    // Reverso: nome vivo -> id. Mantém também o fallback como alias para resolver
    // linhas legadas salvas com o nome antigo.
    for (const f of FILIAIS) {
      normNameToId.set(normalizeFilialNameKey(f.dbNameFallback), f.id);
      const live = idToName.get(f.id);
      if (live) normNameToId.set(normalizeFilialNameKey(live), f.id);
    }

    cache = { idToName, normNameToId, expiresAt: Date.now() + CACHE_TTL_MS };
    return cache;
  } catch {
    // ERP indisponível: usa fallback do registry, sem cachear.
    return buildFallbackCache();
  }
}

/** Invalida o cache (ex.: após o admin alterar uma filial). */
export function invalidateFilialNameCache(): void {
  cache = null;
}

/** Nome atual no banco para um COD_FILIAL. Fallback = dbNameFallback do registry. */
export async function nameForId(id: string | number): Promise<string | null> {
  const regId = toRegistryId(id);
  if (!regId) return null;
  const c = await loadCache();
  return c.idToName.get(regId) ?? getFilialById(regId)?.dbNameFallback ?? null;
}

/** Nomes atuais no banco para uma lista de IDs (preservando ordem, sem duplicar/nulos). */
export async function namesForIds(ids: Array<string | number>): Promise<string[]> {
  const c = await loadCache();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const regId = toRegistryId(id);
    if (!regId) continue;
    const name = c.idToName.get(regId) ?? getFilialById(regId)?.dbNameFallback;
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Resolve um nome de filial (do banco ou legado) de volta para o COD_FILIAL do registry. */
export async function idForName(name: string): Promise<string | null> {
  if (!name) return null;
  const c = await loadCache();
  return c.normNameToId.get(normalizeFilialNameKey(name)) ?? null;
}

/** Mapa completo COD_FILIAL exato -> nome vivo (para montar filtros em lote). */
export async function getIdToNameMap(): Promise<Map<string, string>> {
  return (await loadCache()).idToName;
}

/** Anexa o nome vivo a cada definição do registry (útil para telas de admin/debug). */
export async function withLiveNames(defs: FilialDef[]): Promise<Array<FilialDef & { dbName: string }>> {
  const c = await loadCache();
  return defs.map((f) => ({
    ...f,
    dbName: c.idToName.get(f.id) ?? f.dbNameFallback,
  }));
}
