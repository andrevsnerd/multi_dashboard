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
      pode_ver_outras_filiais BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE transferencia_permissoes ADD COLUMN IF NOT EXISTS pode_ver_outras_filiais BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE transferencia_permissoes ADD COLUMN IF NOT EXISTS filial_atribuida TEXT`;
  await sql`ALTER TABLE transferencia_permissoes ADD COLUMN IF NOT EXISTS filiais_destino_controle JSONB NOT NULL DEFAULT '[]'::jsonb`;
  tableChecked = true;
}

export interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[]; // Códigos das filiais de origem permitidas (saída)
  filiaisDestino: string[]; // Códigos das filiais de destino permitidas (entrada)
  /** Filiais destino visíveis no controle de transferências (quais lojas aparecem como destino sugerido).
   *  Separado de filiaisDestino (entrada). Vazio = todas as da empresa. */
  filiaisDestinoControle?: string[];
  tiposRomaneioPermitidos: string[]; // Tipos de romaneio permitidos (vazio = todos)
  responsavelPadrao?: string; // Responsável padrão (ex: "LOGISTICA")
  tipoRomaneioPadrao?: string; // Tipo de romaneio padrão (ex: "TRANSFERENCIA ENTRE LOJAS")
  responsavelFixo: boolean; // Se true, não permite alterar o responsável
  tipoRomaneioFixo: boolean; // Se true, não permite alterar o tipo de romaneio
  /** Se true, usuário vê todas as filiais (origem/destino), mas só pode transferir nas permitidas. */
  podeVerOutrasFiliais?: boolean;
  /** Filial atribuída para filtro de romaneios: null/""/"TODAS" = vê todos; senão só vê romaneios cujo destino = este código. */
  filialAtribuida?: string | null;
}

/**
 * Busca as permissões de um usuário específico
 * Em desenvolvimento, se Postgres não tiver registro, tenta o arquivo local (data/transferencia-permissoes.json)
 */
export async function getPermissaoByUsername(username: string): Promise<TransferenciaPermissao | null> {
  const normalized = username.toLowerCase().trim();

  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    return permissoes.find((p) => p.username.toLowerCase() === normalized) ?? null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT
      username,
      filiais_origem,
      filiais_destino,
      COALESCE(filiais_destino_controle, '[]'::jsonb) as filiais_destino_controle,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo,
      COALESCE(pode_ver_outras_filiais, false) as pode_ver_outras_filiais,
      filial_atribuida
    FROM transferencia_permissoes
    WHERE username = ${normalized}
    LIMIT 1
  `;

  if (result.length === 0) {
    // Em dev local: se a tabela estiver vazia (ex.: permissões só no JSON), usa o arquivo
    if (process.env.NODE_ENV === 'development') {
      const fromFile = readPermissoesFile();
      return fromFile.find((p) => p.username.toLowerCase() === normalized) ?? null;
    }
    return null;
  }

  const row = result[0];
  return {
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    filiaisDestinoControle: row.filiais_destino_controle || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
    podeVerOutrasFiliais: row.pode_ver_outras_filiais === true,
    filialAtribuida: row.filial_atribuida != null ? String(row.filial_atribuida).trim() || null : null,
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
      filialAtribuida: (permissao.filialAtribuida && permissao.filialAtribuida.trim()) || null,
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
      filiais_destino_controle,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo,
      pode_ver_outras_filiais,
      filial_atribuida,
      updated_at
    )
    VALUES (
      ${username},
      ${JSON.stringify(permissao.filiaisOrigem)}::jsonb,
      ${JSON.stringify(permissao.filiaisDestino)}::jsonb,
      ${JSON.stringify(permissao.filiaisDestinoControle || [])}::jsonb,
      ${JSON.stringify(permissao.tiposRomaneioPermitidos || [])}::jsonb,
      ${permissao.responsavelPadrao || null},
      ${permissao.tipoRomaneioPadrao || null},
      ${permissao.responsavelFixo || false},
      ${permissao.tipoRomaneioFixo || false},
      ${permissao.podeVerOutrasFiliais === true},
      ${(permissao.filialAtribuida && permissao.filialAtribuida.trim()) || null},
      NOW()
    )
    ON CONFLICT (username) DO UPDATE SET
      filiais_origem = EXCLUDED.filiais_origem,
      filiais_destino = EXCLUDED.filiais_destino,
      filiais_destino_controle = EXCLUDED.filiais_destino_controle,
      tipos_romaneio_permitidos = EXCLUDED.tipos_romaneio_permitidos,
      responsavel_padrao = EXCLUDED.responsavel_padrao,
      tipo_romaneio_padrao = EXCLUDED.tipo_romaneio_padrao,
      responsavel_fixo = EXCLUDED.responsavel_fixo,
      tipo_romaneio_fixo = EXCLUDED.tipo_romaneio_fixo,
      pode_ver_outras_filiais = EXCLUDED.pode_ver_outras_filiais,
      filial_atribuida = EXCLUDED.filial_atribuida,
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
      COALESCE(filiais_destino_controle, '[]'::jsonb) as filiais_destino_controle,
      tipos_romaneio_permitidos,
      responsavel_padrao,
      tipo_romaneio_padrao,
      responsavel_fixo,
      tipo_romaneio_fixo,
      COALESCE(pode_ver_outras_filiais, false) as pode_ver_outras_filiais,
      filial_atribuida
    FROM transferencia_permissoes
    ORDER BY username
  `;

  return result.map((row) => ({
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    filiaisDestinoControle: row.filiais_destino_controle || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
    podeVerOutrasFiliais: row.pode_ver_outras_filiais === true,
    filialAtribuida: row.filial_atribuida != null ? String(row.filial_atribuida).trim() || null : null,
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
