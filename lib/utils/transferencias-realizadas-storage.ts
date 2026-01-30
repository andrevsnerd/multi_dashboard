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
  const configured = isRedisConfigured();
  console.log('[tr-realizadas] storage read: companyKey=', companyKey, 'isRedisConfigured=', configured);
  if (!configured) {
    console.log('[tr-realizadas] storage read: Redis nao configurado, retornando []');
    return [];
  }
  const redis = getRedis();
  if (!redis) {
    console.log('[tr-realizadas] storage read: getRedis() null, retornando []');
    return [];
  }
  try {
    const key = REDIS_KEY_PREFIX + companyKey;
    const raw = await redis.get<string[]>(key);
    const result = Array.isArray(raw) ? raw : [];
    console.log('[tr-realizadas] storage read: key=', key, 'count=', result.length);
    return result;
  } catch (error) {
    console.error('[tr-realizadas] storage read ERRO:', error);
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
  const configured = isRedisConfigured();
  console.log('[tr-realizadas] storage write: companyKey=', companyKey, 'markedKeys.length=', markedKeys?.length, 'isRedisConfigured=', configured);
  if (!configured) {
    console.log('[tr-realizadas] storage write: Redis nao configurado, no-op');
    return;
  }
  const redis = getRedis();
  if (!redis) {
    console.log('[tr-realizadas] storage write: getRedis() null, no-op');
    return;
  }
  try {
    const key = REDIS_KEY_PREFIX + companyKey;
    await redis.set(key, markedKeys);
    console.log('[tr-realizadas] storage write: key=', key, 'salvo count=', markedKeys.length);
  } catch (error) {
    console.error('[tr-realizadas] storage write ERRO:', error);
    throw error;
  }
}
