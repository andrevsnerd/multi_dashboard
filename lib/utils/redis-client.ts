/**
 * Cliente Redis compartilhado (mesmo usado pelas metas no Vercel).
 * Suporta UPSTASH_REDIS_REST_*, KV_REST_API_* e variáveis customizadas.
 */

import { Redis } from '@upstash/redis';

export function getRedisEnv(): { url: string | undefined; token: string | undefined } {
  let url = process.env.UPSTASH_REDIS_REST_URL;
  let token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    url = process.env.KV_REST_API_URL;
    token = process.env.KV_REST_API_TOKEN;
  }

  if (!url || !token) {
    const envKeys = Object.keys(process.env);
    const urlKey = envKeys.find(
      (key) =>
        key.endsWith('_REDIS_REST_URL') ||
        key.endsWith('_REDIS_URL') ||
        (key.includes('UPSTASH') && key.includes('URL')) ||
        (key.includes('KV') && key.includes('URL') && key.includes('REST'))
    );
    const tokenKey = envKeys.find(
      (key) =>
        key.endsWith('_REDIS_REST_TOKEN') ||
        key.endsWith('_REDIS_TOKEN') ||
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

export function getRedis(): Redis | null {
  const { url, token } = getRedisEnv();
  if (url && token) {
    return new Redis({ url, token });
  }
  return null;
}

export function isRedisConfigured(): boolean {
  const { url, token } = getRedisEnv();
  return !!(url && token);
}
