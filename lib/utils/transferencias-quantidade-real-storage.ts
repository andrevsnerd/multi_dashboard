/**
 * Armazenamento de "quantidade real" por item de transferência.
 * Usa o banco Neon (Postgres) – mesma base do dashboard (usuários).
 * Chave do item: mesmo formato de getTransferItemKey (produto|cor|origem|destino).
 * NÃO mexe em transferencias-realizadas (Redis).
 */

import { hasPostgres } from '@/lib/db/neon';
import { getNeonSql } from '@/lib/db/neon';

let tableChecked = false;

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS transferencias_quantidade_real (
      company_key TEXT NOT NULL,
      item_key TEXT NOT NULL,
      quantidade_real INTEGER NOT NULL CHECK (quantidade_real >= 0),
      PRIMARY KEY (company_key, item_key)
    )
  `;
  tableChecked = true;
}

/** item_key -> quantidade_real */
export type QuantidadesReaisMap = Record<string, number>;

/**
 * Lê todas as quantidades reais salvas para uma empresa.
 * Se Neon não estiver configurado, retorna {}.
 */
export async function readQuantidadesReais(companyKey: string): Promise<QuantidadesReaisMap> {
  if (!hasPostgres()) {
    return {};
  }
  const sql = getNeonSql();
  await ensureTable(sql);
  const key = companyKey.trim();
  const rows = await sql`
    SELECT item_key, quantidade_real
    FROM transferencias_quantidade_real
    WHERE company_key = ${key}
  `;
  const result: QuantidadesReaisMap = {};
  for (const row of rows as { item_key: string; quantidade_real: number }[]) {
    result[row.item_key] = row.quantidade_real;
  }
  return result;
}

/**
 * Atualiza quantidades reais para uma empresa.
 * updates: item_key -> quantidade_real (número) ou null para remover.
 * Apenas as chaves em updates são alteradas; o restante permanece intacto.
 */
export async function writeQuantidadesReais(
  companyKey: string,
  updates: Record<string, number | null>
): Promise<void> {
  if (!hasPostgres()) {
    return;
  }
  const sql = getNeonSql();
  await ensureTable(sql);
  const key = companyKey.trim();
  for (const [itemKey, value] of Object.entries(updates)) {
    if (value === null || value === undefined) {
      await sql`
        DELETE FROM transferencias_quantidade_real
        WHERE company_key = ${key} AND item_key = ${itemKey}
      `;
    } else {
      const q = Math.max(0, Math.floor(Number(value)));
      await sql`
        INSERT INTO transferencias_quantidade_real (company_key, item_key, quantidade_real)
        VALUES (${key}, ${itemKey}, ${q})
        ON CONFLICT (company_key, item_key)
        DO UPDATE SET quantidade_real = ${q}
      `;
    }
  }
}
