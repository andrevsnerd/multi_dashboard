/**
 * Armazenamento do estado de LEITURA de notificações por usuário.
 *
 * Guarda apenas "qual usuário já leu qual notificação (key)". A existência e o
 * conteúdo das notificações são derivados ao vivo (ver
 * lib/server/notificacoes-saidas.ts); aqui só persistimos o lido/não-lido.
 *
 * Segue o mesmo padrão dos demais stores do projeto: Neon (Postgres) em
 * produção, arquivo JSON local como fallback (sem DATABASE_URL).
 */

import { hasPostgres, getNeonSql } from '@/lib/db/neon';
import fs from 'fs';
import path from 'path';

const LEITURA_FILE = path.join(process.cwd(), 'data', 'notificacoes-leitura.json');

let tableChecked = false;

// ---------- Store em arquivo (local, sem DATABASE_URL) ----------
type LeituraFile = Record<string, Record<string, string>>; // username -> { key -> readAtISO }

function ensureDataDir() {
  const dir = path.dirname(LEITURA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readLeituraFile(): LeituraFile {
  ensureDataDir();
  if (!fs.existsSync(LEITURA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(LEITURA_FILE, 'utf-8')) as LeituraFile;
  } catch {
    return {};
  }
}

function writeLeituraFile(data: LeituraFile) {
  ensureDataDir();
  fs.writeFileSync(LEITURA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS notificacoes_leitura (
      username TEXT NOT NULL,
      notif_key TEXT NOT NULL,
      read_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (username, notif_key)
    )
  `;
  tableChecked = true;
}

/**
 * Retorna o conjunto de keys de notificações que o usuário já leu.
 */
export async function getLidasByUsername(username: string): Promise<Set<string>> {
  const normalized = username.toLowerCase().trim();
  if (!normalized) return new Set();

  if (!hasPostgres()) {
    const data = readLeituraFile();
    return new Set(Object.keys(data[normalized] ?? {}));
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT notif_key FROM notificacoes_leitura WHERE username = ${normalized}
  `;
  return new Set(rows.map((r) => String(r.notif_key)));
}

/**
 * Marca uma ou mais notificações como lidas para o usuário (idempotente).
 */
export async function marcarLidas(username: string, keys: string[]): Promise<void> {
  const normalized = username.toLowerCase().trim();
  const limpos = Array.from(new Set((keys ?? []).map((k) => (k || '').trim()).filter(Boolean)));
  if (!normalized || limpos.length === 0) return;

  if (!hasPostgres()) {
    const data = readLeituraFile();
    const doUsuario = data[normalized] ?? {};
    const agora = new Date().toISOString();
    for (const key of limpos) {
      if (!doUsuario[key]) doUsuario[key] = agora;
    }
    data[normalized] = doUsuario;
    writeLeituraFile(data);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  for (const key of limpos) {
    await sql`
      INSERT INTO notificacoes_leitura (username, notif_key)
      VALUES (${normalized}, ${key})
      ON CONFLICT (username, notif_key) DO NOTHING
    `;
  }
}
