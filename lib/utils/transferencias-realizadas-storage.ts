/**
 * Armazenamento de "transferências realizadas" (marcadas como já feitas, pendentes de atualização no sistema).
 * Persiste APENAS em produção (Redis configurado no Vercel).
 * Em desenvolvimento local: não grava; leitura retorna vazio; no refresh as marcações somem.
 */

import { Redis } from '@upstash/redis';

const REDIS_KEY_PREFIX = 'dashboard:transferencias-realizadas:';

function getRedisEnv() {
  let url = process.env.UPSTASH_REDIS_REST_URL;
  let token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    url = process.env.KV_REST_API_URL;
    token = process.env.KV_REST_API_TOKEN;
  }
  if (!url || !token) {
    const envKeys = Object.keys(process.env);
    const urlKey = envKeys.find(key =>
      key.endsWith('_REDIS_REST_URL') || key.endsWith('_REDIS_URL') ||
      (key.includes('UPSTASH') && key.includes('URL')) ||
      (key.includes('KV') && key.includes('URL') && key.includes('REST'))
    );
    const tokenKey = envKeys.find(key =>
      key.endsWith('_REDIS_REST_TOKEN') || key.endsWith('_REDIS_TOKEN') ||
      (key.includes('UPSTASH') && key.includes('TOKEN')) ||
      (key.includes('KV') && key.includes('TOKEN') && key.includes('REST'))
    );
    if (urlKey && tokenKey) {
      url = process.env[urlKey];
      token = process.env[tokenKey];
    }
  }
  return { url, token };
}

function getRedis(): Redis | null {
  const { url, token } = getRedisEnv();
  if (url && token) {
    return new Redis({ url, token });
  }
  return null;
}

/** Só persiste quando Redis está configurado (ex.: Vercel). Local = não grava. */
function isRedisConfigured(): boolean {
  const { url, token } = getRedisEnv();
  return !!(url && token);
}

export type TransferenciasRealizadasData = Record<string, string[]>;

/**
 * Lê as chaves marcadas como "realizadas" para uma empresa.
 * Em local (sem Redis): retorna sempre {}.
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
 * Em local (sem Redis): no-op; nada é gravado.
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
