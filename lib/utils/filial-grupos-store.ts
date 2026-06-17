import 'server-only';

/**
 * Armazenamento dinâmico de grupos de filiais.
 * Permite ao admin definir quais filiais formam um grupo e qual é a ativa/operacional.
 * Usa arquivo JSON local (dev) ou tabela Postgres (prod).
 */

import { hasPostgres, getNeonSql } from '@/lib/db/neon';
import { invalidateActiveFilialCache } from './active-filial-detector';
import { FILIAL_GROUPS } from '@/lib/config/filial-registry';
import fs from 'fs';
import path from 'path';

const GRUPOS_FILE = path.join(process.cwd(), 'data', 'filial-grupos.json');

let tableChecked = false;

// ── In-memory cache (invalida ao salvar/deletar) ──────────────────────────────
let _cache: FilialGrupo[] | null = null;

function invalidateCache() {
  _cache = null;
}

function normalizeGrupoLabel(grupo: FilialGrupo): FilialGrupo {
  const label = (grupo.label || '').trim();
  const upper = label.toUpperCase();

  if (
    grupo.company === 'nerd' &&
    grupo.id === 'morumbi-1' &&
    (upper === 'NERD MORUMBI RDRRRJ' || upper === 'NERD MORUMBI RDRX')
  ) {
    return { ...grupo, label: 'MORUMBI 1' };
  }

  return grupo;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface FilialGrupo {
  id: string;        // slug único, ex: "morumbi-1"
  label: string;     // nome de exibição, ex: "MORUMBI 1"
  company: string;   // 'nerd' | 'scarfme'
  members: string[]; // todas as filiais do grupo (nomes ERP)
  active: string;    // filial operacional/ativa (deve estar em members)
}

// ── Defaults (seed quando o store está vazio) — DERIVADOS do registry, por ID ──
// members/active são COD_FILIAL. Fonte única de verdade: filial-registry.ts.

export const DEFAULT_GRUPOS: FilialGrupo[] = FILIAL_GROUPS.map((g) => ({
  id: g.id,
  label: g.display,
  company: g.company,
  members: [...g.memberIds],
  active: g.activeId,
}));

// ── Arquivo local ─────────────────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(GRUPOS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readGruposFile(): FilialGrupo[] {
  ensureDataDir();
  if (!fs.existsSync(GRUPOS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(GRUPOS_FILE, 'utf-8')).map(normalizeGrupoLabel);
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
    grupos = rows.map((r) =>
      normalizeGrupoLabel({
        id: r.id,
        label: r.label,
        company: r.company,
        members: r.members || [],
        active: r.active,
      })
    );
  }

  _cache = grupos;
  return grupos;
}

export async function listFilialGruposByCompany(company: string): Promise<FilialGrupo[]> {
  const all = await listFilialGrupos();
  const saved = all.filter((g) => g.company === company.toLowerCase());
  const defaults = DEFAULT_GRUPOS.filter((g) => g.company === company.toLowerCase());

  if (saved.length === 0) return defaults;

  // Merge: defaults como base (mantém ordem), saved substitui por id;
  // grupos salvos sem default correspondente são adicionados ao final.
  const savedById = new Map(saved.map((g) => [g.id, g]));
  const merged = defaults.map((d) => savedById.get(d.id) ?? d);
  for (const s of saved) {
    if (!defaults.some((d) => d.id === s.id)) merged.push(s);
  }
  return merged;
}

export async function saveFilialGrupo(grupo: FilialGrupo): Promise<void> {
  invalidateCache();
  invalidateActiveFilialCache(grupo.id);
  const normalizedGrupo = normalizeGrupoLabel(grupo);

  if (!hasPostgres()) {
    const grupos = readGruposFile();
    const idx = grupos.findIndex((g) => g.id === normalizedGrupo.id);
    if (idx === -1) grupos.push(normalizedGrupo);
    else grupos[idx] = normalizedGrupo;
    writeGruposFile(grupos);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO filial_grupos (id, label, company, members, active, updated_at)
    VALUES (
      ${normalizedGrupo.id},
      ${normalizedGrupo.label},
      ${normalizedGrupo.company},
      ${JSON.stringify(normalizedGrupo.members)}::jsonb,
      ${normalizedGrupo.active},
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
  invalidateActiveFilialCache(id);

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
    // A canônica é a filial ATIVA (não o 1º membro): é a que o filtro de vendas
    // usa e a chave de meta. Membros com a ativa primeiro (lógica de slice(1)).
    const canonical = grupo.active || grupo.members[0];
    if (!canonical) continue;
    const orderedMembers = [canonical, ...grupo.members.filter((m) => m !== canonical)];
    filialGroups[canonical] = orderedMembers;
    for (const member of grupo.members) {
      activeFilials[member] = grupo.active;
    }
  }

  return { filialGroups, activeFilials };
}
