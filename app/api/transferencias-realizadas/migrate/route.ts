import { NextResponse } from 'next/server';
import { getRedis, isRedisConfigured } from '@/lib/utils/redis-client';
import { hasPostgres, getNeonSql } from '@/lib/db/neon';

const REDIS_KEY_PREFIX = 'dashboard:transferencias-realizadas:';

/**
 * API para migrar dados do Redis para Neon
 * Útil quando há dados antigos no Redis que precisam ser migrados
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const companyKey = typeof body.companyKey === 'string' ? body.companyKey.trim() : '';
    const force = body.force === true; // Se true, migra mesmo que já existam dados no Neon

    if (!companyKey) {
      return NextResponse.json(
        { error: 'Parâmetro companyKey é obrigatório' },
        { status: 400 }
      );
    }

    if (!hasPostgres()) {
      return NextResponse.json(
        { error: 'Neon não está configurado. Use DATABASE_URL, POSTGRES_URL ou outra URL exposta pela integração (ver lib/db/neon.ts).' },
        { status: 400 }
      );
    }

    if (!isRedisConfigured()) {
      return NextResponse.json(
        { error: 'Redis não está configurado. Nada para migrar.' },
        { status: 400 }
      );
    }

    const redis = getRedis();
    if (!redis) {
      return NextResponse.json(
        { error: 'Não foi possível conectar ao Redis' },
        { status: 500 }
      );
    }

    // Ler do Redis
    const redisKey = REDIS_KEY_PREFIX + companyKey;
    const redisData = await redis.get<string[]>(redisKey);
    const redisKeys = Array.isArray(redisData) ? redisData : [];

    if (redisKeys.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Nenhum dado encontrado no Redis para migrar',
        migrated: 0,
      });
    }

    // Verificar se já existem dados no Neon
    const sql = getNeonSql();
    await sql`
      CREATE TABLE IF NOT EXISTS transferencias_realizadas (
        company_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (company_key, item_key)
      )
    `;

    const existingRows = await sql`
      SELECT item_key
      FROM transferencias_realizadas
      WHERE company_key = ${companyKey}
    `;
    const existingKeys = new Set((existingRows as { item_key: string }[]).map(r => r.item_key));

    if (existingKeys.size > 0 && !force) {
      return NextResponse.json({
        success: false,
        message: `Já existem ${existingKeys.size} itens no Neon. Use force=true para migrar mesmo assim.`,
        existingInNeon: existingKeys.size,
        inRedis: redisKeys.length,
      });
    }

    // Migrar dados
    let migrated = 0;
    let skipped = 0;
    for (const itemKey of redisKeys) {
      if (!force && existingKeys.has(itemKey)) {
        skipped++;
        continue;
      }
      try {
        await sql`
          INSERT INTO transferencias_realizadas (company_key, item_key)
          VALUES (${companyKey}, ${itemKey})
          ON CONFLICT (company_key, item_key) DO NOTHING
        `;
        migrated++;
      } catch (error) {
        console.error(`[migrate] Erro ao migrar item ${itemKey}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Migração concluída: ${migrated} itens migrados, ${skipped} já existiam`,
      migrated,
      skipped,
      totalInRedis: redisKeys.length,
      totalInNeon: existingKeys.size + migrated,
    });
  } catch (error) {
    console.error('[tr-realizadas] API MIGRATE ERRO:', error);
    return NextResponse.json(
      { error: 'Erro ao migrar dados', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
