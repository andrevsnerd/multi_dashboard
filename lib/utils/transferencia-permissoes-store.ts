/**
 * Armazenamento de permissões de transferência por usuário.
 * Usa o banco Neon (Postgres) em produção ou arquivo JSON local.
 * Define quais filiais de origem e destino cada usuário pode ver,
 * além de responsável padrão e tipo de romaneio padrão.
 */

import { hasPostgres } from '@/lib/db/neon';
import { getNeonSql } from '@/lib/db/neon';
import { getActiveFilial, type CompanyConfig } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import fs from 'fs';
import path from 'path';

const PERMISSOES_FILE = path.join(process.cwd(), 'data', 'transferencia-permissoes.json');

let tableChecked = false;

/**
 * Resolve uma filial (origem/destino/atribuída) para a CANÔNICA ATIVA do grupo, usando a
 * detecção viva (venda mais recente entre os membros — ex.: rodízio MSC↔AKS do e-commerce).
 * DEVE ser dinâmico: se um usuário está atribuído a uma filial de grupo, a canônica gravada
 * precisa acompanhar o rodízio; com a canônica estática, o filtro de romaneios por
 * `filialAtribuida` não casaria com o destino (que as rotas resolvem pela canônica viva).
 * `configs` = configs dinâmicos de nerd/scarfme resolvidos uma vez (evita rodar o detector em loop).
 */
function normalizeFilialAcrossCompanies(
  filial: string | null | undefined,
  configs: Array<CompanyConfig | null>
): string {
  const raw = (filial || '').trim();
  if (!raw || raw.toUpperCase() === 'TODAS') return raw;

  for (const company of configs) {
    if (!company) continue;
    const active = getActiveFilial(company, raw);
    if (active !== raw) return active;
  }

  return raw;
}

function normalizeFilialList(
  filiais: string[] | null | undefined,
  configs: Array<CompanyConfig | null>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filial of filiais ?? []) {
    const active = normalizeFilialAcrossCompanies(filial, configs);
    const key = active.toUpperCase();
    if (!active || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }

  return result;
}

async function normalizePermissao(permissao: TransferenciaPermissao): Promise<TransferenciaPermissao> {
  // Resolve os configs dinâmicos (com a canônica viva) UMA vez para toda a permissão.
  const configs = await Promise.all([
    resolveCompanyDynamic('nerd'),
    resolveCompanyDynamic('scarfme'),
  ]);

  return {
    ...permissao,
    filiaisOrigem: normalizeFilialList(permissao.filiaisOrigem, configs),
    filiaisDestino: normalizeFilialList(permissao.filiaisDestino, configs),
    filiaisDestinoControle: normalizeFilialList(permissao.filiaisDestinoControle, configs),
    filiaisAdicionais: normalizeFilialList(permissao.filiaisAdicionais, configs),
    filialAtribuida: permissao.filialAtribuida
      ? normalizeFilialAcrossCompanies(permissao.filialAtribuida, configs)
      : permissao.filialAtribuida ?? null,
  };
}

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
  await sql`ALTER TABLE transferencia_permissoes ADD COLUMN IF NOT EXISTS filiais_adicionais JSONB NOT NULL DEFAULT '[]'::jsonb`;
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
  /**
   * Filiais ADICIONAIS onde o usuário também opera, além da `filialAtribuida`.
   * Caso de uso: logística da NERD opera na NERD e também na NERD DEFEITOS
   * (confirmar entrada dos romaneios de defeito). Somam-se à filial atribuída em
   * tudo que é por filial: listas de romaneios, confirmação de entrada e
   * saída/entrada direta. Vazio = só a filial atribuída.
   */
  filiaisAdicionais?: string[];
}

/**
 * Busca as permissões de um usuário específico
 * Em desenvolvimento, se Postgres não tiver registro, tenta o arquivo local (data/transferencia-permissoes.json)
 */
export async function getPermissaoByUsername(username: string): Promise<TransferenciaPermissao | null> {
  const normalized = username.toLowerCase().trim();

  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    const permissao = permissoes.find((p) => p.username.toLowerCase() === normalized) ?? null;
    return permissao ? await normalizePermissao(permissao) : null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT
      username,
      filiais_origem,
      filiais_destino,
      COALESCE(filiais_destino_controle, '[]'::jsonb) as filiais_destino_controle,
      COALESCE(filiais_adicionais, '[]'::jsonb) as filiais_adicionais,
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
      const permissao = fromFile.find((p) => p.username.toLowerCase() === normalized) ?? null;
      return permissao ? await normalizePermissao(permissao) : null;
    }
    return null;
  }

  const row = result[0];
  return await normalizePermissao({
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    filiaisDestinoControle: row.filiais_destino_controle || [],
    filiaisAdicionais: row.filiais_adicionais || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
    podeVerOutrasFiliais: row.pode_ver_outras_filiais === true,
    filialAtribuida: row.filial_atribuida != null ? String(row.filial_atribuida).trim() || null : null,
  });
}

/**
 * Salva ou atualiza as permissões de um usuário
 */
export async function savePermissao(permissao: TransferenciaPermissao): Promise<void> {
  const permissaoNormalizada = await normalizePermissao(permissao);
  if (!hasPostgres()) {
    const permissoes = readPermissoesFile();
    const normalized = permissaoNormalizada.username.toLowerCase().trim();
    const index = permissoes.findIndex((p) => p.username.toLowerCase() === normalized);
    
    const permissaoAtualizada: TransferenciaPermissao = {
      ...permissao,
      ...permissaoNormalizada,
      username: normalized,
      filialAtribuida: (permissaoNormalizada.filialAtribuida && permissaoNormalizada.filialAtribuida.trim()) || null,
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

  const username = permissaoNormalizada.username.toLowerCase().trim();

  await sql`
    INSERT INTO transferencia_permissoes (
      username,
      filiais_origem,
      filiais_destino,
      filiais_destino_controle,
      filiais_adicionais,
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
      ${JSON.stringify(permissaoNormalizada.filiaisOrigem)}::jsonb,
      ${JSON.stringify(permissaoNormalizada.filiaisDestino)}::jsonb,
      ${JSON.stringify(permissaoNormalizada.filiaisDestinoControle || [])}::jsonb,
      ${JSON.stringify(permissaoNormalizada.filiaisAdicionais || [])}::jsonb,
      ${JSON.stringify(permissaoNormalizada.tiposRomaneioPermitidos || [])}::jsonb,
      ${permissaoNormalizada.responsavelPadrao || null},
      ${permissaoNormalizada.tipoRomaneioPadrao || null},
      ${permissaoNormalizada.responsavelFixo || false},
      ${permissaoNormalizada.tipoRomaneioFixo || false},
      ${permissaoNormalizada.podeVerOutrasFiliais === true},
      ${(permissaoNormalizada.filialAtribuida && permissaoNormalizada.filialAtribuida.trim()) || null},
      NOW()
    )
    ON CONFLICT (username) DO UPDATE SET
      filiais_origem = EXCLUDED.filiais_origem,
      filiais_destino = EXCLUDED.filiais_destino,
      filiais_destino_controle = EXCLUDED.filiais_destino_controle,
      filiais_adicionais = EXCLUDED.filiais_adicionais,
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
    return Promise.all(readPermissoesFile().map(normalizePermissao));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    SELECT
      username,
      filiais_origem,
      filiais_destino,
      COALESCE(filiais_destino_controle, '[]'::jsonb) as filiais_destino_controle,
      COALESCE(filiais_adicionais, '[]'::jsonb) as filiais_adicionais,
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

  return Promise.all(result.map((row) => normalizePermissao({
    username: row.username,
    filiaisOrigem: row.filiais_origem || [],
    filiaisDestino: row.filiais_destino || [],
    filiaisDestinoControle: row.filiais_destino_controle || [],
    filiaisAdicionais: row.filiais_adicionais || [],
    tiposRomaneioPermitidos: row.tipos_romaneio_permitidos || [],
    responsavelPadrao: row.responsavel_padrao || undefined,
    tipoRomaneioPadrao: row.tipo_romaneio_padrao || undefined,
    responsavelFixo: row.responsavel_fixo || false,
    tipoRomaneioFixo: row.tipo_romaneio_fixo || false,
    podeVerOutrasFiliais: row.pode_ver_outras_filiais === true,
    filialAtribuida: row.filial_atribuida != null ? String(row.filial_atribuida).trim() || null : null,
  })));
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
