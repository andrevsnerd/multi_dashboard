/**
 * Armazenamento de "transferências realizadas" (marcadas como já feitas, pendentes de atualização no sistema).
 * Usa o MESMO Redis/KV das metas (Vercel) – cliente compartilhado em lib/utils/redis-client.ts.
 * Em desenvolvimento local (sem Redis): leitura retorna vazio, escrita é no-op.
 */

import { getRedis, isRedisConfigured } from './redis-client';

const REDIS_KEY_PREFIX = 'dashboard:transferencias-realizadas:';

export type TransferenciasRealizadasData = Record<string, string[]>;

/**
 * Lê as chaves marcadas como "realizadas" para uma empresa.
 * Em produção (Vercel com Redis/KV configurado): lê do mesmo banco das metas.
 */
export async function readTransferenciasRealizadas(companyKey: string): Promise<string[]> {
  if (!isRedisConfigured()) {
    return [];
  }
  const redis = getRedis();
  if (!redis) return [];
  try {
    const key = REDIS_KEY_PREFIX + companyKey;
    const raw = await redis.get<string[]>(key);
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.error('[transferencias-realizadas-storage] Erro ao ler', error);
    return [];
  }
}

/**
 * Salva as chaves marcadas como "realizadas" para uma empresa.
 * Deve receber apenas chaves que ainda estão visíveis na lista (para limpar as que saíram).
 * Em produção (Vercel): grava no mesmo Redis/KV das metas.
 */
export async function writeTransferenciasRealizadas(
  companyKey: string,
  markedKeys: string[]
): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = REDIS_KEY_PREFIX + companyKey;
    await redis.set(key, markedKeys);
  } catch (error) {
    console.error('[transferencias-realizadas-storage] Erro ao salvar', error);
    throw error;
  }
}
