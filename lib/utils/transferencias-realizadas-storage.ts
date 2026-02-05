/**
 * Armazenamento de "transferências realizadas" (marcadas como já feitas, pendentes de atualização no sistema).
 * 
 * ESTRATÉGIA DE PERSISTÊNCIA:
 * 1. Neon (PostgreSQL) é a fonte principal - dados permanentes e seguros
 * 2. Redis/KV é usado como fallback e para migração automática
 * 3. Ao ler: tenta Neon primeiro, depois Redis (e migra se encontrar dados no Redis)
 * 4. Ao escrever: salva em ambos (Neon + Redis) para garantir redundância
 * 
 * Isso garante que os dados não sejam perdidos mesmo após deploys ou mudanças de configuração.
 */

import { getRedis, isRedisConfigured } from './redis-client';
import { hasPostgres, getNeonSql } from '@/lib/db/neon';

const REDIS_KEY_PREFIX = 'dashboard:transferencias-realizadas:';

export type TransferenciasRealizadasData = Record<string, string[]>;

let tableChecked = false;

/**
 * Garante que a tabela existe no Neon
 */
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS transferencias_realizadas (
      company_key TEXT NOT NULL,
      item_key TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (company_key, item_key)
    )
  `;
  tableChecked = true;
}

/**
 * Lê as chaves marcadas como "realizadas" para uma empresa.
 * Prioridade: Neon > Redis (com migração automática)
 */
export async function readTransferenciasRealizadas(companyKey: string): Promise<string[]> {
  const key = companyKey.trim();
  const result: string[] = [];

  // 1. Tentar ler do Neon (fonte principal)
  if (hasPostgres()) {
    try {
      const sql = getNeonSql();
      await ensureTable(sql);
      const rows = await sql`
        SELECT item_key
        FROM transferencias_realizadas
        WHERE company_key = ${key}
        ORDER BY created_at DESC
      `;
      const neonKeys = (rows as { item_key: string }[]).map(r => r.item_key);
      if (neonKeys.length > 0) {
        console.log('[tr-realizadas] storage read: Neon encontrou', neonKeys.length, 'itens para', key);
        result.push(...neonKeys);
      }
    } catch (error) {
      console.error('[tr-realizadas] storage read ERRO Neon:', error);
    }
  }

  // 2. Tentar ler do Redis (fallback e migração)
  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      if (redis) {
        const redisKey = REDIS_KEY_PREFIX + key;
        const raw = await redis.get<string[]>(redisKey);
        const redisKeys = Array.isArray(raw) ? raw : [];
        
        if (redisKeys.length > 0) {
          console.log('[tr-realizadas] storage read: Redis encontrou', redisKeys.length, 'itens para', key);
          
          // Migrar dados do Redis para Neon se Neon estiver disponível
          if (hasPostgres() && result.length === 0) {
            try {
              const sql = getNeonSql();
              await ensureTable(sql);
              // Inserir apenas os que não existem no Neon
              for (const itemKey of redisKeys) {
                await sql`
                  INSERT INTO transferencias_realizadas (company_key, item_key)
                  VALUES (${key}, ${itemKey})
                  ON CONFLICT (company_key, item_key) DO NOTHING
                `;
              }
              console.log('[tr-realizadas] storage read: Migrados', redisKeys.length, 'itens do Redis para Neon');
            } catch (migError) {
              console.error('[tr-realizadas] storage read ERRO migração:', migError);
            }
          }
          
          // Adicionar ao resultado (evitando duplicatas)
          for (const itemKey of redisKeys) {
            if (!result.includes(itemKey)) {
              result.push(itemKey);
            }
          }
        }
      }
    } catch (error) {
      console.error('[tr-realizadas] storage read ERRO Redis:', error);
    }
  }

  console.log('[tr-realizadas] storage read: Total', result.length, 'itens para', key);
  return result;
}

/**
 * Salva as chaves marcadas como "realizadas" para uma empresa.
 * IMPORTANTE: Esta função agora faz MERGE, não substitui tudo.
 * Ela adiciona novas chaves e mantém as existentes, mesmo que não estejam visíveis.
 * 
 * @param companyKey - Chave da empresa
 * @param markedKeys - Novas chaves a serem marcadas (serão adicionadas ao conjunto existente)
 * @param removeKeys - Chaves a serem removidas (opcional, padrão: nenhuma)
 */
export async function writeTransferenciasRealizadas(
  companyKey: string,
  markedKeys: string[],
  removeKeys: string[] = []
): Promise<void> {
  const key = companyKey.trim();
  console.log('[tr-realizadas] storage write: companyKey=', key, 'adicionar=', markedKeys.length, 'remover=', removeKeys.length);

  // Ler dados existentes primeiro
  const existing = await readTransferenciasRealizadas(key);
  const existingSet = new Set(existing);
  
  // Adicionar novas chaves
  for (const itemKey of markedKeys) {
    existingSet.add(itemKey);
  }
  
  // Remover chaves solicitadas
  for (const itemKey of removeKeys) {
    existingSet.delete(itemKey);
  }
  
  const finalKeys = Array.from(existingSet);
  console.log('[tr-realizadas] storage write: Total final', finalKeys.length, 'itens (antes:', existing.length, ')');

  // Salvar no Neon (fonte principal)
  if (hasPostgres()) {
    try {
      const sql = getNeonSql();
      await ensureTable(sql);
      
      // Adicionar novas chaves
      for (const itemKey of markedKeys) {
        await sql`
          INSERT INTO transferencias_realizadas (company_key, item_key)
          VALUES (${key}, ${itemKey})
          ON CONFLICT (company_key, item_key) DO NOTHING
        `;
      }
      
      // Remover chaves solicitadas
      if (removeKeys.length > 0) {
        await sql`
          DELETE FROM transferencias_realizadas
          WHERE company_key = ${key}
            AND item_key = ANY(${removeKeys})
        `;
      }
      
      console.log('[tr-realizadas] storage write: Neon salvo com sucesso');
    } catch (error) {
      console.error('[tr-realizadas] storage write ERRO Neon:', error);
      throw error;
    }
  }

  // Salvar no Redis também (redundância)
  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      if (redis) {
        const redisKey = REDIS_KEY_PREFIX + key;
        await redis.set(redisKey, finalKeys);
        console.log('[tr-realizadas] storage write: Redis salvo com sucesso');
      }
    } catch (error) {
      console.error('[tr-realizadas] storage write ERRO Redis (não crítico):', error);
      // Não lança erro aqui - Redis é apenas redundância
    }
  }
}
