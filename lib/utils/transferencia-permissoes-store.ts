/**
 * Armazenamento de permissões de transferência por usuário.
 * Usa o banco Neon (Postgres) em produção ou arquivo JSON local.
 * Define quais filiais de origem e destino cada usuário pode ver,
 * além de responsável padrão e tipo de romaneio padrão.
 */

import { hasPostgres } from '@/lib/db/neon';
import { getNeonSql } from '@/lib/db/neon';
import fs from 'fs';
import path from 'path';

const PERMISSOES_FILE = path.join(process.cwd(), 'data', 'transferencia-permissoes.json');

let tableChecked = false;

// ---------- Store em arquivo (local, sem DATABASE_URL) ----------
function ensureDataDir() {
  const dir = path.dirname(PERMISSOES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readPermissoesFile(): TransferenciaPermissao[] {
  ensureDataDir();
  if (!fs.existsSync(PERMISSOES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PERMISSOES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writePermissoesFile(permissoes: TransferenciaPermissao[]) {
  ensureDataDir();
  fs.writeFileSync(PERMISSOES_FILE, JSON.stringify(permissoes, null, 2), 'utf-8');
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS transferencia_permissoes (
      username TEXT PRIMARY KEY,
      filiais_origem JSONB NOT NULL DEFAULT '[]'::jsonb,
      filiais_destino JSONB NOT NULL DEFAULT '[]'::jsonb,
      tipos_romaneio_permitidos JSONB NOT NULL DEFAULT '[]'::jsonb,
      responsavel_padrao TEXT,
      tipo_romaneio_padrao TEXT,
      responsavel_fixo BOOLEAN NOT NULL DEFAULT false,
      tipo_romaneio_fixo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

export interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[]; // Códigos das filiais de origem permitidas
  filiaisDestino: string[]; // Códigos das filiais de destino permitidas
  tiposRomaneioPermitidos: string[]; // Tipos de romaneio permitidos (vazio = todos)
  responsavelPadrao?: string; // Responsável padrão (ex: "LOGISTICA")
  tipoRomaneioPadrao?: string; // Tipo de romaneio padrão (ex: "TRANSFERENCIA ENTRE LOJAS")
  responsavelFixo: boolean; // Se true, não permite alterar o responsável
  tipoRomaneioFixo: boolean; // Se true, não permite alterar o tipo de romaneio
}

/**
 * Busca as permissões de um usuário específico
 */
export async function getPermissaoByUsername(username: string): Promise<TransferenciaPermissao | null> {
  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    const normalized = username.toLowerCase().trim();
    return permissoes.find((p) => p.username.toLowerCase() === normalized) ?? null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT 
      username,
      filiais_origem,
      filiais_destino,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo
    FROM transferencia_permissoes
    WHERE username = ${username.toLowerCase().trim()}
    LIMIT 1
  `;

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
  };
}

/**
 * Salva ou atualiza as permissões de um usuário
 */
export async function savePermissao(permissao: TransferenciaPermissao): Promise<void> {
  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    const normalized = permissao.username.toLowerCase().trim();
    const index = permissoes.findIndex((p) => p.username.toLowerCase() === normalized);
    
    const permissaoAtualizada: TransferenciaPermissao = {
      ...permissao,
      username: normalized,
    };
    
    if (index === -1) {
      permissoes.push(permissaoAtualizada);
    } else {
      permissoes[index] = permissaoAtualizada;
    }
    
    writePermissoesFile(permissoes);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const username = permissao.username.toLowerCase().trim();

  await sql`
    INSERT INTO transferencia_permissoes (
      username,
      filiais_origem,
      filiais_destino,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo,
      updated_at
    )
    VALUES (
      ${username},
      ${JSON.stringify(permissao.filiaisOrigem)}::jsonb,
      ${JSON.stringify(permissao.filiaisDestino)}::jsonb,
      ${JSON.stringify(permissao.tiposRomaneioPermitidos || [])}::jsonb,
      ${permissao.responsavelPadrao || null},
      ${permissao.tipoRomaneioPadrao || null},
      ${permissao.responsavelFixo || false},
      ${permissao.tipoRomaneioFixo || false},
      NOW()
    )
    ON CONFLICT (username) DO UPDATE SET
      filiais_origem = EXCLUDED.filiais_origem,
      filiais_destino = EXCLUDED.filiais_destino,
      tipos_romaneio_permitidos = EXCLUDED.tipos_romaneio_permitidos,
      responsavel_padrao = EXCLUDED.responsavel_padrao,
      tipo_romaneio_padrao = EXCLUDED.tipo_romaneio_padrao,
      responsavel_fixo = EXCLUDED.responsavel_fixo,
      tipo_romaneio_fixo = EXCLUDED.tipo_romaneio_fixo,
      updated_at = NOW()
  `;
}

/**
 * Lista todas as permissões (para admin)
 */
export async function listAllPermissoes(): Promise<TransferenciaPermissao[]> {
  if (!hasPostgres()) {
    return readPermissoesFile();
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT 
      username,
      filiais_origem,
      filiais_destino,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo
    FROM transferencia_permissoes
    ORDER BY username
  `;

  return result.map((row) => ({
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
  }));
}

/**
 * Remove as permissões de um usuário
 */
export async function deletePermissao(username: string): Promise<void> {
  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    const normalized = username.toLowerCase().trim();
    const filtered = permissoes.filter((p) => p.username.toLowerCase() !== normalized);
    if (filtered.length === permissoes.length) {
      throw new Error('Permissão não encontrada');
    }
    writePermissoesFile(filtered);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    DELETE FROM transferencia_permissoes
    WHERE username = ${username.toLowerCase().trim()}
  `;
}
