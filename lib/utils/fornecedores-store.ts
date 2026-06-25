import 'server-only';

/**
 * Armazenamento dinâmico de grupos de fornecedores.
 * Permite cadastrar manualmente fornecedores (Externo / Centro / ...) e as
 * regras que definem quais produtos cada um captura. Usa arquivo JSON local
 * (dev) ou tabela Postgres (prod). Espelha o padrão de filial-grupos-store.ts.
 *
 * Escopo inicial: NERD apenas (SCARF ME terá regras próprias no futuro).
 */

import { hasPostgres, getNeonSql } from '@/lib/db/neon';
import type { Fornecedor, FornecedorItem, FornecedorModo } from '@/lib/utils/fornecedor-matcher';
import fs from 'fs';
import path from 'path';

export type { Fornecedor, FornecedorItem, FornecedorModo };

const FORNECEDORES_FILE = path.join(process.cwd(), 'data', 'fornecedores.json');

let tableChecked = false;

// ── In-memory cache (invalida ao salvar/deletar) ──────────────────────────────
let _cache: Fornecedor[] | null = null;

function invalidateCache() {
  _cache = null;
}

// ── Marcas NF (fornecedor externo) — semente derivada dos scripts Python ──────
// estoque_produto_geral_nerd.py: produtos com nota fiscal de terceiros.
const MARCAS_FORNECEDOR_EXTERNO = [
  'GEONAV', 'VOLT', 'UNIQ', 'INFINITY', 'LEGEND', '1KASE', 'LAUT', 'HPRIME',
  'OEX', 'KIMASTER', 'AYA PITAYA', 'BASEUS', 'IMENSO', 'QCY', 'ZEISS', 'X-ONE',
  'ALÇA NERD', 'TAG METAL NERD',
];

const SEED_TS = '2026-01-01T00:00:00.000Z';

// ── Defaults (seed quando o store está vazio) ─────────────────────────────────

export const DEFAULT_FORNECEDORES: Fornecedor[] = [
  {
    id: 'nerd-fornecedor-externo',
    company: 'nerd',
    nome: 'Fornecedor Externo',
    modo: 'explicito',
    termosDescricao: [...MARCAS_FORNECEDOR_EXTERNO],
    itens: [],
    ignorarFornecedorIds: [],
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  },
  {
    id: 'nerd-fornecedor-centro',
    company: 'nerd',
    nome: 'Fornecedor Centro',
    modo: 'complemento',
    termosDescricao: [],
    itens: [],
    ignorarFornecedorIds: ['nerd-fornecedor-externo'],
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  },
];

// ── Normalização ──────────────────────────────────────────────────────────────

function normalizeFornecedor(raw: Partial<Fornecedor>): Fornecedor {
  const nowIso = SEED_TS;
  return {
    id: String(raw.id ?? '').trim(),
    company: String(raw.company ?? '').toLowerCase().trim(),
    nome: String(raw.nome ?? '').trim(),
    modo: (raw.modo === 'complemento' ? 'complemento' : 'explicito') as FornecedorModo,
    termosDescricao: Array.isArray(raw.termosDescricao)
      ? raw.termosDescricao.map((t) => String(t).trim()).filter(Boolean)
      : [],
    itens: Array.isArray(raw.itens)
      ? raw.itens
          .map((i) => ({ produto: String(i?.produto ?? '').trim(), cor: i?.cor ? String(i.cor).trim() : null }))
          .filter((i) => i.produto)
      : [],
    ignorarFornecedorIds: Array.isArray(raw.ignorarFornecedorIds)
      ? raw.ignorarFornecedorIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    createdAt: raw.createdAt ? String(raw.createdAt) : nowIso,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : nowIso,
  };
}

// ── Arquivo local ─────────────────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(FORNECEDORES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFornecedoresFile(): Fornecedor[] {
  ensureDataDir();
  if (!fs.existsSync(FORNECEDORES_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(FORNECEDORES_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed.map(normalizeFornecedor) : [];
  } catch {
    return [];
  }
}

function writeFornecedoresFile(fornecedores: Fornecedor[]) {
  ensureDataDir();
  fs.writeFileSync(FORNECEDORES_FILE, JSON.stringify(fornecedores, null, 2), 'utf-8');
}

// ── Postgres ──────────────────────────────────────────────────────────────────

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS fornecedores (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      nome TEXT NOT NULL,
      modo TEXT NOT NULL DEFAULT 'explicito',
      termos_descricao JSONB NOT NULL DEFAULT '[]'::jsonb,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      ignorar_fornecedor_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  tableChecked = true;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listFornecedores(): Promise<Fornecedor[]> {
  if (_cache !== null) return _cache;

  let fornecedores: Fornecedor[];

  if (!hasPostgres()) {
    fornecedores = readFornecedoresFile();
  } else {
    const sql = getNeonSql();
    await ensureTable(sql);
    const rows = await sql`
      SELECT id, company, nome, modo, termos_descricao, itens, ignorar_fornecedor_ids, created_at, updated_at
      FROM fornecedores
      ORDER BY company, nome
    `;
    fornecedores = rows.map((r) =>
      normalizeFornecedor({
        id: r.id,
        company: r.company,
        nome: r.nome,
        modo: r.modo,
        termosDescricao: r.termos_descricao || [],
        itens: r.itens || [],
        ignorarFornecedorIds: r.ignorar_fornecedor_ids || [],
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      })
    );
  }

  _cache = fornecedores;
  return fornecedores;
}

/** Merge defaults+saved por id: defaults como base (mantém ordem), saved substitui. */
export async function listFornecedoresByCompany(company: string): Promise<Fornecedor[]> {
  const all = await listFornecedores();
  const lc = company.toLowerCase();
  const saved = all.filter((f) => f.company === lc);
  const defaults = DEFAULT_FORNECEDORES.filter((f) => f.company === lc);

  if (saved.length === 0) return defaults;

  const savedById = new Map(saved.map((f) => [f.id, f]));
  const merged = defaults.map((d) => savedById.get(d.id) ?? d);
  for (const s of saved) {
    if (!defaults.some((d) => d.id === s.id)) merged.push(s);
  }
  return merged;
}

export async function saveFornecedor(input: Partial<Fornecedor>): Promise<Fornecedor> {
  const nowIso = new Date().toISOString();

  if (!hasPostgres()) {
    const fornecedores = readFornecedoresFile();
    const existing = fornecedores.find((f) => f.id === input.id);
    const fornecedor = normalizeFornecedor({
      ...input,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
    const idx = fornecedores.findIndex((f) => f.id === fornecedor.id);
    if (idx === -1) fornecedores.push(fornecedor);
    else fornecedores[idx] = fornecedor;
    writeFornecedoresFile(fornecedores);
    invalidateCache();
    return fornecedor;
  }

  const fornecedor = normalizeFornecedor({ ...input, createdAt: nowIso, updatedAt: nowIso });
  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO fornecedores (id, company, nome, modo, termos_descricao, itens, ignorar_fornecedor_ids, updated_at)
    VALUES (
      ${fornecedor.id},
      ${fornecedor.company},
      ${fornecedor.nome},
      ${fornecedor.modo},
      ${JSON.stringify(fornecedor.termosDescricao)}::jsonb,
      ${JSON.stringify(fornecedor.itens)}::jsonb,
      ${JSON.stringify(fornecedor.ignorarFornecedorIds)}::jsonb,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      company = EXCLUDED.company,
      nome = EXCLUDED.nome,
      modo = EXCLUDED.modo,
      termos_descricao = EXCLUDED.termos_descricao,
      itens = EXCLUDED.itens,
      ignorar_fornecedor_ids = EXCLUDED.ignorar_fornecedor_ids,
      updated_at = NOW()
  `;
  invalidateCache();
  return fornecedor;
}

export async function deleteFornecedor(id: string): Promise<void> {
  if (!hasPostgres()) {
    const fornecedores = readFornecedoresFile();
    writeFornecedoresFile(fornecedores.filter((f) => f.id !== id));
    invalidateCache();
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`DELETE FROM fornecedores WHERE id = ${id}`;
  invalidateCache();
}
