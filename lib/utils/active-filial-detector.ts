import 'server-only';

import sql from 'mssql';
import { withRequest } from '@/lib/db/connection';
import type { FilialGrupo } from './filial-grupos-store';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

interface CacheEntry {
  active: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function normUpper(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function queryLastSaleVarejo(
  request: Parameters<Parameters<typeof withRequest>[0]>[0],
  members: string[],
  suffix: string
): Promise<string | null> {
  // Busca COD_FILIAL de cada membro pelo nome e pega a venda mais recente
  const inParams = members.map((_, i) => `@m${suffix}_${i}`).join(', ');
  for (const [i, m] of members.entries()) {
    request.input(`m${suffix}_${i}`, sql.NVarChar, normUpper(m));
  }

  const result = await request.query<{ FILIAL: string }>(`
    SELECT TOP 1 RTRIM(LTRIM(fil.FILIAL)) AS FILIAL
    FROM FILIAIS fil WITH (NOLOCK)
    INNER JOIN LOJA_VENDA v WITH (NOLOCK) ON v.CODIGO_FILIAL = fil.COD_FILIAL
    WHERE UPPER(RTRIM(LTRIM(fil.FILIAL))) IN (${inParams})
    ORDER BY v.DATA_VENDA DESC
  `);

  return result.recordset[0]?.FILIAL?.trim() ?? null;
}

async function queryLastSaleEcommerce(
  request: Parameters<Parameters<typeof withRequest>[0]>[0],
  members: string[],
  suffix: string
): Promise<string | null> {
  const inParams = members.map((_, i) => `@e${suffix}_${i}`).join(', ');
  for (const [i, m] of members.entries()) {
    request.input(`e${suffix}_${i}`, sql.NVarChar, normUpper(m));
  }

  const result = await request.query<{ FILIAL: string }>(`
    SELECT TOP 1 RTRIM(LTRIM(f.FILIAL)) AS FILIAL
    FROM FATURAMENTO f WITH (NOLOCK)
    WHERE UPPER(RTRIM(LTRIM(f.FILIAL))) IN (${inParams})
      AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
    ORDER BY f.EMISSAO DESC
  `);

  return result.recordset[0]?.FILIAL?.trim() ?? null;
}

/**
 * Detecta a filial ativa de cada grupo consultando qual membro teve venda mais
 * recente. Grupos com um único membro retornam diretamente o active configurado.
 * Resultados são cacheados por 5 minutos; em caso de falha, usa active do grupo.
 *
 * @param grupos        Lista de grupos da empresa
 * @param ecommerceFilials  Nomes das filiais de e-commerce (usam FATURAMENTO)
 * @returns Map de groupId → nome da filial ativa detectada
 */
export async function detectActiveFilials(
  grupos: FilialGrupo[],
  ecommerceFilials: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const ecommerceSet = new Set(ecommerceFilials.map(normUpper));

  // Grupos que precisam de detecção (mais de um membro)
  const toDetect = grupos.filter((g) => g.members.length > 1);

  if (toDetect.length === 0) {
    for (const g of grupos) result.set(g.id, g.active);
    return result;
  }

  // Verifica cache para todos
  const needsQuery = toDetect.filter((g) => {
    const cached = cache.get(g.id);
    if (cached && cached.expiresAt > Date.now()) {
      result.set(g.id, cached.active);
      return false;
    }
    return true;
  });

  if (needsQuery.length > 0) {
    try {
      await withRequest(async (request) => {
        for (const [i, grupo] of needsQuery.entries()) {
          const isEcommerce = grupo.members.some((m) => ecommerceSet.has(normUpper(m)));
          let detected: string | null = null;

          try {
            detected = isEcommerce
              ? await queryLastSaleEcommerce(request, grupo.members, `${i}`)
              : await queryLastSaleVarejo(request, grupo.members, `${i}`);
          } catch {
            // falha individual: usa active configurado
          }

          // Fallback: active configurado
          const active = detected ?? grupo.active;
          cache.set(grupo.id, { active, expiresAt: Date.now() + CACHE_TTL_MS });
          result.set(grupo.id, active);
        }
      });
    } catch {
      // falha geral de conexão: usa active configurado para os que faltam
      for (const g of needsQuery) {
        if (!result.has(g.id)) result.set(g.id, g.active);
      }
    }
  }

  // Grupos com membro único: usa active diretamente
  for (const g of grupos) {
    if (!result.has(g.id)) result.set(g.id, g.active);
  }

  return result;
}

/** Invalida o cache de detecção (útil após salvar um grupo no admin). */
export function invalidateActiveFilialCache(groupId?: string) {
  if (groupId) {
    cache.delete(groupId);
  } else {
    cache.clear();
  }
}
