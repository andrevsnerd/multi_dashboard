import 'server-only';

/**
 * Armazenamento dinâmico de grupos de filiais.
 * Permite ao admin definir quais filiais formam um grupo e qual é a ativa/operacional.
 * Usa arquivo JSON local (dev) ou tabela Postgres (prod).
 */

import { hasPostgres, getNeonSql } from '@/lib/db/neon';
import fs from 'fs';
import path from 'path';

const GRUPOS_FILE = path.join(process.cwd(), 'data', 'filial-grupos.json');

let tableChecked = false;

// ── In-memory cache (invalida ao salvar/deletar) ──────────────────────────────
let _cache: FilialGrupo[] | null = null;

function invalidateCache() {
  _cache = null;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface FilialGrupo {
  id: string;        // slug único, ex: "morumbi-1"
  label: string;     // nome de exibição, ex: "MORUMBI 1"
  company: string;   // 'nerd' | 'scarfme'
  members: string[]; // todas as filiais do grupo (nomes ERP)
  active: string;    // filial operacional/ativa (deve estar em members)
}

// ── Defaults hardcoded (seed quando o store está vazio para uma empresa) ──────

export const DEFAULT_GRUPOS: FilialGrupo[] = [
  {
    id: 'morumbi-1',
    label: 'MORUMBI 1',
    company: 'nerd',
    members: ['NERD MORUMBI RDRRRJ', 'NERD MORUMBI RDRX'],
    active: 'NERD MORUMBI RDRX',
  },
  {
    id: 'morumbi-2',
    label: 'MORUMBI 2',
    company: 'nerd',
    members: ['NERD MORUMBI RDRRX'],
    active: 'NERD MORUMBI RDRRX',
  },
  {
    id: 'paulista',
    label: 'PAULISTA',
    company: 'scarfme',
    members: ['SCARFME ME - PAULISTA FFF', 'SCARF ME - PAULISTA RSR', 'SCARF ME - PAULISTA FFFR'],
    active: 'SCARF ME - PAULISTA RSR',
  },
  {
    id: 'ecommerce-scarfme',
    label: 'E-COMMERCE',
    company: 'scarfme',
    members: [
      'SCARFME MATRIZ CMS',
      'SCARF ME - MATRIZ LLL',
      'SCARF ME MATRIZ - FFF',
      'MSC COMERCIO DE LENCOS LT',
    ],
    active: 'MSC COMERCIO DE LENCOS LT',
  },
];

// ── Arquivo local ─────────────────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(GRUPOS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readGruposFile(): FilialGrupo[] {
  ensureDataDir();
  if (!fs.existsSync(GRUPOS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(GRUPOS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeGruposFile(grupos: FilialGrupo[]) {
  ensureDataDir();
  fs.writeFileSync(GRUPOS_FILE, JSON.stringify(grupos, null, 2), 'utf-8');
}

// ── Postgres ──────────────────────────────────────────────────────────────────

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS filial_grupos (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      company TEXT NOT NULL,
      members JSONB NOT NULL DEFAULT '[]'::jsonb,
      active TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listFilialGrupos(): Promise<FilialGrupo[]> {
  if (_cache !== null) return _cache;

  let grupos: FilialGrupo[];

  if (!hasPostgres()) {
    grupos = readGruposFile();
  } else {
    const sql = getNeonSql();
    await ensureTable(sql);
    const rows = await sql`
      SELECT id, label, company, members, active
      FROM filial_grupos
      ORDER BY company, label
    `;
    grupos = rows.map((r) => ({
      id: r.id,
      label: r.label,
      company: r.company,
      members: r.members || [],
      active: r.active,
    }));
  }

  _cache = grupos;
  return grupos;
}

export async function listFilialGruposByCompany(company: string): Promise<FilialGrupo[]> {
  const all = await listFilialGrupos();
  const filtered = all.filter((g) => g.company === company.toLowerCase());
  // Se vazio, retorna os defaults para essa empresa (sem salvar — só exibição)
  if (filtered.length === 0) {
    return DEFAULT_GRUPOS.filter((g) => g.company === company.toLowerCase());
  }
  return filtered;
}

export async function saveFilialGrupo(grupo: FilialGrupo): Promise<void> {
  invalidateCache();

  if (!hasPostgres()) {
    const grupos = readGruposFile();
    const idx = grupos.findIndex((g) => g.id === grupo.id);
    if (idx === -1) grupos.push(grupo);
    else grupos[idx] = grupo;
    writeGruposFile(grupos);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO filial_grupos (id, label, company, members, active, updated_at)
    VALUES (
      ${grupo.id},
      ${grupo.label},
      ${grupo.company},
      ${JSON.stringify(grupo.members)}::jsonb,
      ${grupo.active},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      company = EXCLUDED.company,
      members = EXCLUDED.members,
      active = EXCLUDED.active,
      updated_at = NOW()
  `;
}

export async function deleteFilialGrupo(id: string): Promise<void> {
  invalidateCache();

  if (!hasPostgres()) {
    const grupos = readGruposFile();
    const filtered = grupos.filter((g) => g.id !== id);
    writeGruposFile(filtered);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`DELETE FROM filial_grupos WHERE id = ${id}`;
}

/**
 * Deriva filialGroups e activeFilials a partir de FilialGrupo[],
 * prontos para sobrescrever os campos de CompanyConfig.
 */
export function buildDerivedFilialConfig(grupos: FilialGrupo[]): {
  filialGroups: Record<string, string[]>;
  activeFilials: Record<string, string>;
} {
  const filialGroups: Record<string, string[]> = {};
  const activeFilials: Record<string, string> = {};

  for (const grupo of grupos) {
    const canonical = grupo.members[0];
    if (!canonical) continue;
    filialGroups[canonical] = grupo.members;
    for (const member of grupo.members) {
      activeFilials[member] = grupo.active;
    }
  }

  return { filialGroups, activeFilials };
}
