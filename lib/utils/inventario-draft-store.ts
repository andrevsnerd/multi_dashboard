import "server-only";

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * RASCUNHOS DO INVENTÁRIO POR BIPAGEM — a lista que o operador está bipando,
 * persistida no Neon a cada alteração (mesmo desenho dos rascunhos de
 * Saídas/Entradas, em tabela própria).
 *
 * Inventário é a bipagem mais longa do sistema (a loja inteira, peça a peça):
 * se a aba fechar ou a máquina cair antes de subir o estoque, o trabalho não
 * pode se perder. Existe UM rascunho por (empresa × usuário × filial) — ele É a
 * lista da tela. Some quando o estoque é subido.
 */

const DATA_FILE = path.join(process.cwd(), "data", "inventario-rascunhos.json");

export interface InventarioRascunhoItem {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  /** Peça P/M/G: posição da grade (null = sem tamanho / ainda não escolhido). */
  tamanho?: number | null;
  tamanhoLabel?: string | null;
}

export interface InventarioRascunho {
  id: string;
  companyKey: string;
  username: string;
  /** COD_FILIAL do Linx (o inventário é sempre de uma filial física). */
  filialCod: string;
  filialNome: string;
  nomeContagem: string;
  /** O usuário digitou a descrição? (senão ela segue a sugestão automática) */
  nomeEditado: boolean;
  observacao: string;
  zerarNaoContados: boolean;
  itens: InventarioRascunhoItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SalvarInventarioRascunhoInput {
  companyKey: string;
  username: string;
  filialCod: string;
  filialNome?: string | null;
  nomeContagem?: string | null;
  nomeEditado?: boolean;
  observacao?: string | null;
  zerarNaoContados?: boolean;
  itens: InventarioRascunhoItem[];
}

// ─────────────────────────── helpers ───────────────────────────

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

/** Chave natural: a tela recalcula a partir do contexto e faz upsert. */
export function inventarioRascunhoId(companyKey: string, username: string, filialCod: string): string {
  return [norm(companyKey).toLowerCase(), norm(username).toLowerCase(), "inventario", norm(filialCod).toUpperCase()].join(
    "::"
  );
}

function sanitizeItens(itens: unknown): InventarioRascunhoItem[] {
  if (!Array.isArray(itens)) return [];
  return itens
    .map((raw) => {
      const item = (raw ?? {}) as Partial<InventarioRascunhoItem>;
      return {
        produto: norm(item.produto),
        descProduto: norm(item.descProduto),
        codigoBarra: norm(item.codigoBarra) || null,
        corProduto: norm(item.corProduto) || null,
        descCor: norm(item.descCor),
        quantidade: Math.max(1, Math.trunc(Number(item.quantidade) || 1)),
        tamanho: Number.isInteger(Number(item.tamanho)) && Number(item.tamanho) > 0 ? Number(item.tamanho) : null,
        tamanhoLabel: norm(item.tamanhoLabel) || null,
      };
    })
    .filter((item) => item.produto.length > 0);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function rowToRascunho(row: Record<string, unknown>): InventarioRascunho {
  const itensRaw = row.itens;
  const itens = typeof itensRaw === "string" ? JSON.parse(itensRaw) : itensRaw;
  return {
    id: norm(row.id),
    companyKey: norm(row.company_key),
    username: norm(row.username),
    filialCod: norm(row.filial_cod),
    filialNome: norm(row.filial_nome) || norm(row.filial_cod),
    nomeContagem: norm(row.nome_contagem),
    nomeEditado: row.nome_editado === true,
    observacao: norm(row.observacao),
    zerarNaoContados: row.zerar_nao_contados !== false,
    itens: sanitizeItens(itens),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ─────────────────────── fallback em arquivo ───────────────────────

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFileRascunhos(): InventarioRascunho[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileRascunhos(rows: InventarioRascunho[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

// ─────────────────────────── DDL ───────────────────────────

let ensurePromise: Promise<void> | null = null;

/** CREATE TABLE concorrente: 23505/42P07 = o objeto já existe, é sucesso. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ddl(exec: () => Promise<unknown>): Promise<void> {
  try {
    await exec();
  } catch (erro) {
    if (!objetoJaExiste(erro)) throw erro;
  }
}

async function runMigrations(): Promise<void> {
  const sql = getNeonSql();
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS inventario_rascunhos (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      username TEXT NOT NULL,
      filial_cod TEXT NOT NULL,
      filial_nome TEXT NOT NULL DEFAULT '',
      nome_contagem TEXT NOT NULL DEFAULT '',
      nome_editado BOOLEAN NOT NULL DEFAULT FALSE,
      observacao TEXT NOT NULL DEFAULT '',
      zerar_nao_contados BOOLEAN NOT NULL DEFAULT TRUE,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS inventario_rascunhos_company_idx
      ON inventario_rascunhos (company_key, updated_at DESC)
  `);
}

async function ensureTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runMigrations().catch((erro) => {
      ensurePromise = null;
      throw erro;
    });
  }
  return ensurePromise;
}

// ─────────────────────────── API ───────────────────────────

/** Grava (ou substitui) o rascunho. Lista vazia apaga — "Limpar lista" não deixa fantasma. */
export async function salvarInventarioRascunho(
  input: SalvarInventarioRascunhoInput
): Promise<InventarioRascunho | null> {
  const companyKey = norm(input.companyKey);
  const username = norm(input.username);
  const filialCod = norm(input.filialCod);
  if (!companyKey || !username || !filialCod) return null;

  const itens = sanitizeItens(input.itens);
  const id = inventarioRascunhoId(companyKey, username, filialCod);

  if (itens.length === 0) {
    await removerInventarioRascunho(id);
    return null;
  }

  const filialNome = norm(input.filialNome) || filialCod;
  const nomeContagem = norm(input.nomeContagem).slice(0, 25);
  const nomeEditado = input.nomeEditado === true;
  const observacao = norm(input.observacao);
  const zerarNaoContados = input.zerarNaoContados !== false;

  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    const idx = rows.findIndex((r) => r.id === id);
    const agora = new Date().toISOString();
    const registro: InventarioRascunho = {
      id,
      companyKey,
      username,
      filialCod,
      filialNome,
      nomeContagem,
      nomeEditado,
      observacao,
      zerarNaoContados,
      itens,
      createdAt: idx >= 0 ? rows[idx].createdAt : agora,
      updatedAt: agora,
    };
    if (idx >= 0) rows[idx] = registro;
    else rows.push(registro);
    writeFileRascunhos(rows);
    return registro;
  }

  const sql = getNeonSql();
  await ensureTable();

  const result = await sql`
    INSERT INTO inventario_rascunhos (
      id, company_key, username, filial_cod, filial_nome, nome_contagem,
      nome_editado, observacao, zerar_nao_contados, itens, updated_at
    ) VALUES (
      ${id}, ${companyKey}, ${username}, ${filialCod}, ${filialNome}, ${nomeContagem},
      ${nomeEditado}, ${observacao}, ${zerarNaoContados}, ${JSON.stringify(itens)}::jsonb, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      filial_nome = EXCLUDED.filial_nome,
      nome_contagem = EXCLUDED.nome_contagem,
      nome_editado = EXCLUDED.nome_editado,
      observacao = EXCLUDED.observacao,
      zerar_nao_contados = EXCLUDED.zerar_nao_contados,
      itens = EXCLUDED.itens,
      updated_at = NOW()
    RETURNING *
  `;

  return result.length > 0 ? rowToRascunho(result[0] as Record<string, unknown>) : null;
}

/** Rascunhos pendentes da empresa, mais recentes primeiro. */
export async function listarInventarioRascunhos(companyKey: string): Promise<InventarioRascunho[]> {
  const company = norm(companyKey);
  if (!company) return [];

  if (!hasPostgres()) {
    return readFileRascunhos()
      .filter((r) => norm(r.companyKey).toLowerCase() === company.toLowerCase())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const sql = getNeonSql();
  await ensureTable();

  const rows = await sql`
    SELECT * FROM inventario_rascunhos
    WHERE LOWER(company_key) = LOWER(${company})
    ORDER BY updated_at DESC
    LIMIT 200
  `;
  return rows.map((row) => rowToRascunho(row as Record<string, unknown>));
}

export async function removerInventarioRascunho(id: string): Promise<void> {
  const key = norm(id);
  if (!key) return;

  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    const restantes = rows.filter((r) => r.id !== key);
    if (restantes.length !== rows.length) writeFileRascunhos(restantes);
    return;
  }

  const sql = getNeonSql();
  await ensureTable();
  await sql`DELETE FROM inventario_rascunhos WHERE id = ${key}`;
}
