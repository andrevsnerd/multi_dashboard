/**
 * Armazenamento de permissões de transferência por usuário.
 * Usa o banco Neon (Postgres) em produção ou arquivo JSON local.
 * Define quais filiais de origem e destino cada usuário pode ver,
 * além de responsável padrão e tipo de romaneio padrão.
 *
 * ── Filial de grupo é gravada como GRUPO, nunca como CNPJ ─────────────────────
 * Filial que pertence a um grupo (rodízio do e-commerce, troca de CNPJ da loja) é
 * gravada como `grupo:<id>` (ex.: `grupo:ecommerce-scarfme`) e, na leitura, vira a
 * perna ATIVA do grupo naquele momento. Quem usa a permissão (admin, telas, rotas)
 * continua recebendo nomes de filial, como antes.
 *
 * Por quê: gravar o nome da perna ativa congelava o CNPJ do dia do cadastro. Quando
 * esse CNPJ trocou de grupo, a permissão foi junto — o usuário `ecommerce` tinha
 * "MSC COMERCIO DE LENCOS LT" de quando a MSC era o e-commerce; em 19/11/2026 a MSC
 * virou a Higienópolis e a saída dele passou a consultar o saldo da Higienópolis.
 *
 * Nome solto (legado) continua valendo: vira a ativa do grupo a que a filial pertence
 * HOJE. COD solto (ex.: "000111") NÃO é reinterpretado: a leitura nunca casou COD, e
 * transformá-lo em grupo agora liberaria filiais que o usuário nunca teve na prática.
 */

import { hasPostgres } from '@/lib/db/neon';
import { getNeonSql } from '@/lib/db/neon';
import { getActiveFilial, type CompanyConfig } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { idForFilialRef, liveNameForFilialRef } from '@/lib/server/company-live';
import {
  DEFAULT_GRUPOS,
  listFilialGruposByCompany,
  type FilialGrupo,
} from '@/lib/utils/filial-grupos-store';
import fs from 'fs';
import path from 'path';

const PERMISSOES_FILE = path.join(process.cwd(), 'data', 'transferencia-permissoes.json');

let tableChecked = false;

/** Prefixo da referência a GRUPO gravada na permissão (ex.: `grupo:higienopolis-scarfme`). */
export const GRUPO_REF_PREFIX = 'grupo:';

const EMPRESAS_COM_GRUPO = ['nerd', 'scarfme'] as const;

export function isGrupoRef(value: string | null | undefined): boolean {
  return (value || '').trim().toLowerCase().startsWith(GRUPO_REF_PREFIX);
}

/** Contexto resolvido UMA vez por permissão (o detector de perna ativa não roda em loop). */
interface ContextoFiliais {
  configs: Array<CompanyConfig | null>;
  grupos: FilialGrupo[];
}

async function carregarContexto(): Promise<ContextoFiliais> {
  const [configs, grupos] = await Promise.all([
    Promise.all(EMPRESAS_COM_GRUPO.map((c) => resolveCompanyDynamic(c))),
    Promise.all(
      EMPRESAS_COM_GRUPO.map((c) =>
        // Neon fora: a composição do registry basta (membro quase nunca muda).
        listFilialGruposByCompany(c).catch(() => DEFAULT_GRUPOS.filter((g) => g.company === c))
      )
    ).then((listas) => listas.flat()),
  ]);
  return { configs, grupos };
}

/**
 * Resolve uma filial (origem/destino/atribuída) para a CANÔNICA ATIVA do grupo, usando a
 * detecção viva (venda mais recente entre os membros — ex.: rodízio do e-commerce).
 * DEVE ser dinâmico: se um usuário está atribuído a uma filial de grupo, a canônica gravada
 * precisa acompanhar o rodízio; com a canônica estática, o filtro de romaneios por
 * `filialAtribuida` não casaria com o destino (que as rotas resolvem pela canônica viva).
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

/** `grupo:<id>` → nome da perna ativa do grupo agora. Grupo desconhecido fica como está (não casa nada). */
async function resolverGrupoRef(ref: string, ctx: ContextoFiliais): Promise<string> {
  const id = ref.trim().slice(GRUPO_REF_PREFIX.length).trim();
  const grupo = ctx.grupos.find((g) => g.id === id);
  if (!grupo) return ref.trim();
  const config = ctx.configs.find((c) => c?.key?.toLowerCase() === grupo.company.toLowerCase()) ?? null;
  // Qualquer membro serve de ponto de partida: activeFilials mapeia todos para a ativa viva.
  const pontoDePartida = await liveNameForFilialRef(grupo.active);
  if (!pontoDePartida) return ref.trim();
  return getActiveFilial(config, pontoDePartida);
}

async function resolverFilial(value: string | null | undefined, ctx: ContextoFiliais): Promise<string> {
  if (isGrupoRef(value)) return resolverGrupoRef(value as string, ctx);
  return normalizeFilialAcrossCompanies(value, ctx.configs);
}

async function resolverLista(filiais: string[] | null | undefined, ctx: ContextoFiliais): Promise<string[]> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const filial of filiais ?? []) {
    const active = await resolverFilial(filial, ctx);
    const key = active.toUpperCase();
    if (!active || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }
  return result;
}

/** Leitura: devolve a permissão com NOMES de filial, já na perna ativa de cada grupo. */
export async function normalizePermissao(permissao: TransferenciaPermissao): Promise<TransferenciaPermissao> {
  const ctx = await carregarContexto();
  return {
    ...permissao,
    filiaisOrigem: await resolverLista(permissao.filiaisOrigem, ctx),
    filiaisDestino: await resolverLista(permissao.filiaisDestino, ctx),
    filiaisDestinoControle: await resolverLista(permissao.filiaisDestinoControle, ctx),
    filiaisAdicionais: await resolverLista(permissao.filiaisAdicionais, ctx),
    filialAtribuida: permissao.filialAtribuida
      ? await resolverFilial(permissao.filialAtribuida, ctx)
      : permissao.filialAtribuida ?? null,
  };
}

/** COD_FILIAL → id do grupo, montado uma vez por gravação. */
async function mapaFilialParaGrupo(grupos: FilialGrupo[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const g of grupos) {
    for (const ref of [...g.members, g.active]) {
      const cod = await idForFilialRef(ref);
      if (cod && !mapa.has(cod)) mapa.set(cod, g.id);
    }
  }
  return mapa;
}

/**
 * Gravação: filial de grupo vira `grupo:<id>`. O valor chega do admin como o nome da
 * perna ativa NO MOMENTO do cadastro — é nesse momento que o grupo é decidido, e daí
 * em diante a permissão acompanha o grupo, não o CNPJ.
 */
async function paraReferenciaArmazenada(
  value: string | null | undefined,
  ctx: ContextoFiliais,
  filialParaGrupo: Map<string, string>
): Promise<string> {
  const raw = (value || '').trim();
  if (!raw || raw.toUpperCase() === 'TODAS') return raw;
  if (isGrupoRef(raw)) return `${GRUPO_REF_PREFIX}${raw.slice(GRUPO_REF_PREFIX.length).trim()}`;
  // COD solto é legado sem efeito (a leitura só casa por nome): não reinterpretar.
  if (/^\d+$/.test(raw)) return raw;

  const nome = normalizeFilialAcrossCompanies(raw, ctx.configs);
  const cod = await idForFilialRef(nome);
  const grupoId = cod ? filialParaGrupo.get(cod) : undefined;
  return grupoId ? `${GRUPO_REF_PREFIX}${grupoId}` : nome;
}

async function paraListaArmazenada(
  filiais: string[] | null | undefined,
  ctx: ContextoFiliais,
  filialParaGrupo: Map<string, string>
): Promise<string[]> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const filial of filiais ?? []) {
    const ref = await paraReferenciaArmazenada(filial, ctx, filialParaGrupo);
    const key = ref.toUpperCase();
    if (!ref || seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export async function paraArmazenamento(permissao: TransferenciaPermissao): Promise<TransferenciaPermissao> {
  const ctx = await carregarContexto();
  const filialParaGrupo = await mapaFilialParaGrupo(ctx.grupos);
  const atribuida = permissao.filialAtribuida
    ? await paraReferenciaArmazenada(permissao.filialAtribuida, ctx, filialParaGrupo)
    : null;
  return {
    ...permissao,
    filiaisOrigem: await paraListaArmazenada(permissao.filiaisOrigem, ctx, filialParaGrupo),
    filiaisDestino: await paraListaArmazenada(permissao.filiaisDestino, ctx, filialParaGrupo),
    filiaisDestinoControle: await paraListaArmazenada(permissao.filiaisDestinoControle, ctx, filialParaGrupo),
    filiaisAdicionais: await paraListaArmazenada(permissao.filiaisAdicionais, ctx, filialParaGrupo),
    filialAtribuida: atribuida || null,
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
  // Grava filial de grupo como `grupo:<id>` (ver o topo do arquivo); a leitura resolve a ativa.
  const permissaoNormalizada = await paraArmazenamento(permissao);
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
