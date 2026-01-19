/**
 * Utilitário para gerenciar armazenamento de metas
 * Usa Upstash Redis em produção, fallback para arquivo em desenvolvimento
 */

import { Redis } from '@upstash/redis';
import { promises as fs } from 'fs';
import path from 'path';

const GOALS_FILE_PATH = path.join(process.cwd(), 'data', 'goals.json');
const REDIS_KEY = 'dashboard:goals';

export interface GoalData {
  [companyKey: string]: {
    [year: string]: {
      [month: string]: {
        [filial: string]: number;
      };
    };
  };
}

/**
 * Obtém as variáveis de ambiente do Redis (suporta prefixo customizado)
 */
function getRedisEnv() {
  // Tenta primeiro com prefixo padrão (UPSTASH_REDIS_REST_*)
  let url = process.env.UPSTASH_REDIS_REST_URL;
  let token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  // Se não encontrar, tenta com prefixo customizado (procura qualquer variável que termine com _REDIS_REST_URL)
  if (!url || !token) {
    // Procura variáveis que terminam com _REDIS_REST_URL e _REDIS_REST_TOKEN
    const envKeys = Object.keys(process.env);
    const urlKey = envKeys.find(key => key.endsWith('_REDIS_REST_URL'));
    const tokenKey = envKeys.find(key => key.endsWith('_REDIS_REST_TOKEN'));
    
    if (urlKey && tokenKey) {
      url = process.env[urlKey];
      token = process.env[tokenKey];
    }
  }
  
  return { url, token };
}

/**
 * Cria instância do Redis (apenas se as variáveis estiverem configuradas)
 */
function getRedis(): Redis | null {
  const { url, token } = getRedisEnv();
  
  if (url && token) {
    return new Redis({
      url,
      token,
    });
  }
  return null;
}

/**
 * Verifica se deve usar Redis (produção) ou arquivo (desenvolvimento)
 */
function shouldUseRedis(): boolean {
  const { url, token } = getRedisEnv();
  return !!(url && token);
}

/**
 * Garante que o arquivo de metas existe (para desenvolvimento)
 */
async function ensureGoalsFile(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }

  try {
    await fs.access(GOALS_FILE_PATH);
  } catch {
    await fs.writeFile(GOALS_FILE_PATH, JSON.stringify({}), 'utf-8');
  }
}

/**
 * Lê metas do Redis ou arquivo
 */
export async function readGoals(): Promise<GoalData> {
  if (shouldUseRedis()) {
    const redis = getRedis();
    if (redis) {
      try {
        const data = await redis.get<GoalData>(REDIS_KEY);
        return data || {};
      } catch (error) {
        console.error('Erro ao ler metas do Redis:', error);
        return {};
      }
    }
  }
  
  // Fallback para arquivo em desenvolvimento
  await ensureGoalsFile();
  try {
    const content = await fs.readFile(GOALS_FILE_PATH, 'utf-8');
    return JSON.parse(content) as GoalData;
  } catch {
    return {};
  }
}

/**
 * Salva metas no Redis ou arquivo
 */
export async function writeGoals(goals: GoalData): Promise<void> {
  if (shouldUseRedis()) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(REDIS_KEY, goals);
        return;
      } catch (error) {
        console.error('Erro ao salvar metas no Redis:', error);
        throw error;
      }
    }
  }
  
  // Fallback para arquivo em desenvolvimento
  await ensureGoalsFile();
  await fs.writeFile(GOALS_FILE_PATH, JSON.stringify(goals, null, 2), 'utf-8');
}
