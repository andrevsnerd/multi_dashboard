import "server-only";

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * RASCUNHOS DE SAÍDA/ENTRADA — a lista que o operador está montando na tela,
 * persistida no Neon a cada alteração.
 *
 * Motivo: com a bipagem por código de barras a lista vira o trabalho de verdade
 * (dezenas de peças conferidas uma a uma). Se a aba fechar, a máquina cair ou a
 * sessão expirar antes de registrar o romaneio, tudo o que foi bipado se perde.
 * O rascunho é gravado a cada item, então a tela sempre volta de onde parou.
 *
 * Ciclo de vida: existe UM rascunho por (empresa × usuário × tipo × filial ×
 * romaneio em edição) — ele É a lista da tela, não uma cópia. Ao registrar o
 * romaneio com sucesso o rascunho é apagado; enquanto não for registrado,
 * aparece na aba "Rascunhos".
 *
 * `romaneioEdicao` separa dois trabalhos que acontecem na MESMA filial e no
 * mesmo tipo: montar um romaneio novo (vazio) e acrescentar itens a um romaneio
 * de entrada já gravado. Sem essa dimensão os dois disputariam a mesma chave e
 * um apagaria o outro.
 */

const DATA_FILE = path.join(process.cwd(), "data", "saida-entrada-rascunhos.json");

export type TipoOperacaoRascunho = "saida" | "entrada";

export interface RascunhoItem {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  /** Saldo na filial no momento em que o item entrou na lista (só informativo). */
  estoque: number;
}

export interface SaidaEntradaRascunho {
  id: string;
  companyKey: string;
  username: string;
  tipoOperacao: TipoOperacaoRascunho;
  /** Filial da operação (nome canônico — o mesmo `codFilial` que a tela usa). */
  filial: string;
  filialLabel: string;
  filialDestino: string | null;
  filialDestinoLabel: string | null;
  tipoRomaneio: string;
  observacao: string;
  /** Romaneio de entrada sendo editado; null quando o rascunho é de romaneio novo. */
  romaneioEdicao: string | null;
  itens: RascunhoItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SalvarRascunhoInput {
  companyKey: string;
  username: string;
  tipoOperacao: TipoOperacaoRascunho;
  filial: string;
  filialLabel?: string | null;
  filialDestino?: string | null;
  filialDestinoLabel?: string | null;
  tipoRomaneio?: string | null;
  observacao?: string | null;
  romaneioEdicao?: string | null;
  itens: RascunhoItem[];
}

// ─────────────────────────── helpers ───────────────────────────

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Chave natural do rascunho. Determinística de propósito: a tela não precisa
 * guardar id nenhum — recalcula a chave a partir do contexto atual e faz upsert.
 */
export function rascunhoId(
  companyKey: string,
  username: string,
  tipoOperacao: string,
  filial: string,
  romaneioEdicao?: string | null
): string {
  const base = [
    norm(companyKey).toLowerCase(),
    norm(username).toLowerCase(),
    norm(tipoOperacao).toLowerCase(),
    norm(filial).toUpperCase(),
  ].join("::");
  // Sufixo só quando há romaneio em edição: as chaves antigas continuam válidas.
  const romaneio = norm(romaneioEdicao).toUpperCase();
  return romaneio ? `${base}::R${romaneio}` : base;
}

function sanitizeItens(itens: unknown): RascunhoItem[] {
  if (!Array.isArray(itens)) return [];
  return itens
    .map((raw) => {
      const item = (raw ?? {}) as Partial<RascunhoItem>;
      return {
        produto: norm(item.produto),
        descProduto: norm(item.descProduto),
        codigoBarra: norm(item.codigoBarra) || null,
        corProduto: norm(item.corProduto) || null,
        descCor: norm(item.descCor),
        quantidade: Math.max(1, Math.trunc(Number(item.quantidade) || 1)),
        estoque: Math.trunc(Number(item.estoque) || 0),
      };
    })
    .filter((item) => item.produto.length > 0);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function rowToRascunho(row: Record<string, unknown>): SaidaEntradaRascunho {
  const itensRaw = row.itens;
  const itens = typeof itensRaw === "string" ? JSON.parse(itensRaw) : itensRaw;
  return {
    id: norm(row.id),
    companyKey: norm(row.company_key),
    username: norm(row.username),
    tipoOperacao: norm(row.tipo_operacao) === "entrada" ? "entrada" : "saida",
    filial: norm(row.filial),
    filialLabel: norm(row.filial_label) || norm(row.filial),
    filialDestino: norm(row.filial_destino) || null,
    filialDestinoLabel: norm(row.filial_destino_label) || null,
    tipoRomaneio: norm(row.tipo_romaneio),
    observacao: norm(row.observacao),
    romaneioEdicao: norm(row.romaneio_edicao) || null,
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

function readFileRascunhos(): SaidaEntradaRascunho[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileRascunhos(rows: SaidaEntradaRascunho[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

// ─────────────────────────── DDL ───────────────────────────

let ensurePromise: Promise<void> | null = null;

/**
 * `CREATE TABLE IF NOT EXISTS` não é atômico contra criação concorrente: dois
 * pedidos simultâneos rodam o DDL juntos e um morre com unique violation em
 * `pg_type` (23505) ou "relation already exists" (42P07). Nos dois casos o
 * objeto passou a existir — é sucesso, não erro.
 */
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
    CREATE TABLE IF NOT EXISTS saida_entrada_rascunhos (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      username TEXT NOT NULL,
      tipo_operacao TEXT NOT NULL,
      filial TEXT NOT NULL,
      filial_label TEXT NOT NULL DEFAULT '',
      filial_destino TEXT,
      filial_destino_label TEXT,
      tipo_romaneio TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL DEFAULT '',
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS saida_entrada_rascunhos_company_idx
      ON saida_entrada_rascunhos (company_key, updated_at DESC)
  `);
  // Coluna nova em base já criada: rascunho de edição de romaneio de entrada.
  await ddl(() => sql`
    ALTER TABLE saida_entrada_rascunhos
      ADD COLUMN IF NOT EXISTS romaneio_edicao TEXT
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

/**
 * Grava (ou substitui) o rascunho da combinação empresa × usuário × tipo × filial.
 * Lista vazia apaga o rascunho — sem isso "Limpar lista" deixaria um fantasma na aba.
 */
export async function salvarRascunho(
  input: SalvarRascunhoInput
): Promise<SaidaEntradaRascunho | null> {
  const companyKey = norm(input.companyKey);
  const username = norm(input.username);
  const tipoOperacao: TipoOperacaoRascunho = input.tipoOperacao === "entrada" ? "entrada" : "saida";
  const filial = norm(input.filial);

  if (!companyKey || !username || !filial) return null;

  const itens = sanitizeItens(input.itens);
  const romaneioEdicao = norm(input.romaneioEdicao) || null;
  const id = rascunhoId(companyKey, username, tipoOperacao, filial, romaneioEdicao);

  if (itens.length === 0) {
    await removerRascunho(id);
    return null;
  }

  const filialLabel = norm(input.filialLabel) || filial;
  const filialDestino = norm(input.filialDestino) || null;
  const filialDestinoLabel = norm(input.filialDestinoLabel) || filialDestino;
  const tipoRomaneio = norm(input.tipoRomaneio);
  const observacao = norm(input.observacao);

  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    const idx = rows.findIndex((r) => r.id === id);
    const agora = new Date().toISOString();
    const registro: SaidaEntradaRascunho = {
      id,
      companyKey,
      username,
      tipoOperacao,
      filial,
      filialLabel,
      filialDestino,
      filialDestinoLabel,
      tipoRomaneio,
      observacao,
      romaneioEdicao,
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
    INSERT INTO saida_entrada_rascunhos (
      id, company_key, username, tipo_operacao, filial, filial_label,
      filial_destino, filial_destino_label, tipo_romaneio, observacao,
      romaneio_edicao, itens, updated_at
    ) VALUES (
      ${id}, ${companyKey}, ${username}, ${tipoOperacao}, ${filial}, ${filialLabel},
      ${filialDestino}, ${filialDestinoLabel}, ${tipoRomaneio}, ${observacao},
      ${romaneioEdicao}, ${JSON.stringify(itens)}::jsonb, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      filial_label = EXCLUDED.filial_label,
      filial_destino = EXCLUDED.filial_destino,
      filial_destino_label = EXCLUDED.filial_destino_label,
      tipo_romaneio = EXCLUDED.tipo_romaneio,
      observacao = EXCLUDED.observacao,
      romaneio_edicao = EXCLUDED.romaneio_edicao,
      itens = EXCLUDED.itens,
      updated_at = NOW()
    RETURNING *
  `;

  return result.length > 0 ? rowToRascunho(result[0] as Record<string, unknown>) : null;
}

/** Rascunhos pendentes da empresa, mais recentes primeiro. */
export async function listarRascunhos(companyKey: string): Promise<SaidaEntradaRascunho[]> {
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
    SELECT * FROM saida_entrada_rascunhos
    WHERE LOWER(company_key) = LOWER(${company})
    ORDER BY updated_at DESC
    LIMIT 200
  `;

  return rows.map((row) => rowToRascunho(row as Record<string, unknown>));
}

export async function buscarRascunho(id: string): Promise<SaidaEntradaRascunho | null> {
  const key = norm(id);
  if (!key) return null;

  if (!hasPostgres()) {
    return readFileRascunhos().find((r) => r.id === key) ?? null;
  }

  const sql = getNeonSql();
  await ensureTable();

  const rows = await sql`SELECT * FROM saida_entrada_rascunhos WHERE id = ${key} LIMIT 1`;
  return rows.length > 0 ? rowToRascunho(rows[0] as Record<string, unknown>) : null;
}

export async function removerRascunho(id: string): Promise<void> {
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
  await sql`DELETE FROM saida_entrada_rascunhos WHERE id = ${key}`;
}
