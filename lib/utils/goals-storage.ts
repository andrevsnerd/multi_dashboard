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
    const urlKey = envKeys.find(key => 
      key.endsWith('_REDIS_REST_URL') || 
      key.endsWith('_REDIS_URL') ||
      key.includes('UPSTASH') && key.includes('URL')
    );
    const tokenKey = envKeys.find(key => 
      key.endsWith('_REDIS_REST_TOKEN') || 
      key.endsWith('_REDIS_TOKEN') ||
      key.includes('UPSTASH') && key.includes('TOKEN')
    );
    
    if (urlKey && tokenKey) {
      url = process.env[urlKey];
      token = process.env[tokenKey];
      console.log('[goals-storage] Variáveis encontradas com prefixo customizado:', {
        urlKey,
        tokenKey,
        hasUrl: !!url,
        hasToken: !!token
      });
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
  const { url, token } = getRedisEnv();
  const usingRedis = shouldUseRedis();
  
  console.log('[goals-storage] Verificando Redis:', {
    hasUrl: !!url,
    hasToken: !!token,
    usingRedis,
    envKeys: Object.keys(process.env).filter(k => k.includes('REDIS') || k.includes('UPSTASH'))
  });
  
  if (usingRedis) {
    const redis = getRedis();
    if (redis) {
      try {
        console.log('[goals-storage] Tentando ler do Redis...');
        const data = await redis.get<GoalData>(REDIS_KEY);
        console.log('[goals-storage] Dados lidos do Redis:', data ? 'encontrados' : 'vazios');
        return data || {};
      } catch (error) {
        console.error('[goals-storage] Erro ao ler metas do Redis:', error);
        return {};
      }
    }
  }
  
  // Fallback para arquivo em desenvolvimento
  console.log('[goals-storage] Usando fallback para arquivo local');
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
  const { url, token } = getRedisEnv();
  const usingRedis = shouldUseRedis();
  
  console.log('[goals-storage] Salvando metas:', {
    hasUrl: !!url,
    hasToken: !!token,
    usingRedis,
    goalsCount: Object.keys(goals).length
  });
  
  if (usingRedis) {
    const redis = getRedis();
    if (redis) {
      try {
        console.log('[goals-storage] Tentando salvar no Redis...');
        await redis.set(REDIS_KEY, goals);
        console.log('[goals-storage] Metas salvas no Redis com sucesso!');
        return;
      } catch (error) {
        console.error('[goals-storage] Erro ao salvar metas no Redis:', error);
        throw error;
      }
    }
  }
  
  // Fallback para arquivo em desenvolvimento
  console.log('[goals-storage] Usando fallback para arquivo local');
  await ensureGoalsFile();
  await fs.writeFile(GOALS_FILE_PATH, JSON.stringify(goals, null, 2), 'utf-8');
}
