import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  buildVmKey,
  normalizeVmValue,
  type VmDirecao,
  type VmItem,
  type VmMovimento,
} from "@/lib/utils/vm";

/**
 * Store da lista de VM (peças em exposição) — Neon (Postgres) em produção, arquivo JSON
 * local quando não há DATABASE_URL. Mesmo padrão do produto-descontinuado-store.
 *
 * Duas tabelas:
 *   vm_items      — o estado atual (quem está em VM agora). PK = company+filial+produto+cor.
 *   vm_movimentos — o log de tudo que entrou e saiu, com o ROMANEIO_PRODUTO da saída/
 *                   entrada VM que moveu o estoque no Linx. É a nossa auditoria; o
 *                   movimento em si vive no Linx e aparece no Extrato de Produto.
 */

const VM_ITEMS_FILE = path.join(process.cwd(), "data", "vm-items.json");
const VM_MOVIMENTOS_FILE = path.join(process.cwd(), "data", "vm-movimentos.json");

let tablesPromise: Promise<void> | null = null;

function ensureDataDir(file: string) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonArray<T>(file: string): T[] {
  ensureDataDir(file);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(file: string, rows: T[]) {
  ensureDataDir(file);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf-8");
}

/**
 * `CREATE TABLE IF NOT EXISTS` NÃO é atômico no Postgres: dois CREATEs concorrentes para a
 * mesma tabela passam os dois pela checagem de existência e o segundo estoura na unique de
 * `pg_type` (23505) ou em "relation already exists" (42P07). Acontecia de verdade aqui — a
 * rota GET chama listVmItems e listVmMovimentos em Promise.all. Nesse caso o objeto existe,
 * que é tudo o que queríamos, então o erro é benigno.
 */
function isDuplicateObjectError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P07" || code === "23505";
}

async function ddl(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isDuplicateObjectError(error)) throw error;
  }
}

/**
 * Cria as tabelas uma única vez por processo. O promise memoizado serializa chamadas
 * concorrentes (elas aguardam a mesma execução em vez de disputar o CREATE); em erro real
 * o memo é limpo para a próxima chamada poder tentar de novo.
 */
async function ensureTables(sql: ReturnType<typeof getNeonSql>): Promise<void> {
  if (!tablesPromise) {
    tablesPromise = criarTabelas(sql).catch((error) => {
      tablesPromise = null;
      throw error;
    });
  }
  return tablesPromise;
}

async function criarTabelas(sql: ReturnType<typeof getNeonSql>): Promise<void> {
  // Cada DDL tolera o próprio erro de duplicidade — se um CREATE perder a corrida, os
  // seguintes ainda rodam (engolir o erro do bloco inteiro deixaria tabela faltando).
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS vm_items (
      company TEXT NOT NULL,
      filial TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor TEXT NOT NULL,
      filial_nome TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      desc_cor TEXT NOT NULL DEFAULT '',
      romaneio TEXT,
      criado_por TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company, filial, produto, cor)
    )
  `);

  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS vm_movimentos (
      id SERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      filial TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      desc_cor TEXT NOT NULL DEFAULT '',
      direcao TEXT NOT NULL,
      romaneio TEXT,
      usuario TEXT,
      obs TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS vm_movimentos_company_filial_idx
    ON vm_movimentos (company, filial, criado_em DESC)
  `);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function sortItems(items: VmItem[]): VmItem[] {
  return [...items].sort(
    (a, b) =>
      a.filialNome.localeCompare(b.filialNome, "pt-BR") ||
      a.filial.localeCompare(b.filial, "pt-BR") ||
      a.descricao.localeCompare(b.descricao, "pt-BR") ||
      a.cor.localeCompare(b.cor, "pt-BR")
  );
}

/** Peças em VM da empresa. `filiais` vazio/ausente = todas (escopo já resolvido por quem chama). */
export async function listVmItems(
  company: CompanyKey,
  filiais?: string[] | null
): Promise<VmItem[]> {
  const escopo = (filiais ?? [])
    .map((f) => normalizeVmValue(f))
    .filter(Boolean);
  const dentroDoEscopo = (filial: string) =>
    escopo.length === 0 || escopo.some((f) => f.toUpperCase() === filial.toUpperCase());

  if (!hasPostgres()) {
    return sortItems(
      readJsonArray<VmItem>(VM_ITEMS_FILE).filter(
        (row) => row.company === company && dentroDoEscopo(row.filial)
      )
    );
  }

  const sql = getNeonSql();
  await ensureTables(sql);

  const rows = await sql`
    SELECT company, filial, filial_nome, produto, cor, descricao, desc_cor,
           romaneio, criado_por, created_at, updated_at
    FROM vm_items
    WHERE company = ${company}
    ORDER BY filial_nome, filial, descricao, cor
  `;

  return sortItems(
    rows
      .map((row) => ({
        company: row.company as CompanyKey,
        filial: normalizeVmValue(row.filial),
        filialNome: normalizeVmValue(row.filial_nome),
        produto: normalizeVmValue(row.produto),
        cor: normalizeVmValue(row.cor),
        descricao: normalizeVmValue(row.descricao),
        descCor: normalizeVmValue(row.desc_cor),
        romaneio: row.romaneio ? normalizeVmValue(row.romaneio) : null,
        criadoPor: row.criado_por ? normalizeVmValue(row.criado_por) : null,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      }))
      .filter((row) => dentroDoEscopo(row.filial))
  );
}

export interface VmItemInput {
  company: CompanyKey;
  filial: string;
  filialNome: string;
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  romaneio: string | null;
  criadoPor: string | null;
}

/**
 * Grava as peças na lista. Chamado SOMENTE depois de a saída VM ter dado certo no Linx —
 * a lista nunca deve afirmar que uma peça está em VM se o estoque não saiu.
 */
export async function addVmItems(itens: VmItemInput[]): Promise<VmItem[]> {
  if (itens.length === 0) return [];

  const nowIso = new Date().toISOString();
  const novos: VmItem[] = itens.map((item) => ({
    company: item.company,
    filial: normalizeVmValue(item.filial),
    filialNome: normalizeVmValue(item.filialNome),
    produto: normalizeVmValue(item.produto),
    cor: normalizeVmValue(item.cor),
    descricao: normalizeVmValue(item.descricao) || normalizeVmValue(item.produto),
    descCor: normalizeVmValue(item.descCor),
    romaneio: item.romaneio ? normalizeVmValue(item.romaneio) : null,
    criadoPor: item.criadoPor ? normalizeVmValue(item.criadoPor) : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  if (!hasPostgres()) {
    const chavesNovas = new Set(novos.map((n) => `${n.company}::${buildVmKey(n.filial, n.produto, n.cor)}`));
    const restantes = readJsonArray<VmItem>(VM_ITEMS_FILE).filter(
      (row) => !chavesNovas.has(`${row.company}::${buildVmKey(row.filial, row.produto, row.cor)}`)
    );
    writeJsonArray(VM_ITEMS_FILE, [...restantes, ...novos]);
    return novos;
  }

  const sql = getNeonSql();
  await ensureTables(sql);

  for (const item of novos) {
    await sql`
      INSERT INTO vm_items (
        company, filial, filial_nome, produto, cor, descricao, desc_cor,
        romaneio, criado_por, created_at, updated_at
      ) VALUES (
        ${item.company}, ${item.filial}, ${item.filialNome}, ${item.produto}, ${item.cor},
        ${item.descricao}, ${item.descCor}, ${item.romaneio}, ${item.criadoPor},
        ${new Date(item.createdAt)}, ${new Date(item.updatedAt)}
      )
      ON CONFLICT (company, filial, produto, cor) DO UPDATE SET
        filial_nome = EXCLUDED.filial_nome,
        descricao = EXCLUDED.descricao,
        desc_cor = EXCLUDED.desc_cor,
        romaneio = EXCLUDED.romaneio,
        criado_por = EXCLUDED.criado_por,
        updated_at = EXCLUDED.updated_at
    `;
  }

  return novos;
}

export interface VmItemRef {
  company: CompanyKey;
  filial: string;
  produto: string;
  cor: string;
}

/**
 * Remove peças da lista. Chamado SOMENTE depois de a entrada VM ter devolvido a
 * peça ao estoque — o inverso da regra do add.
 */
export async function removeVmItems(refs: VmItemRef[]): Promise<number> {
  if (refs.length === 0) return 0;

  if (!hasPostgres()) {
    const alvo = new Set(refs.map((r) => `${r.company}::${buildVmKey(r.filial, r.produto, r.cor)}`));
    const rows = readJsonArray<VmItem>(VM_ITEMS_FILE);
    const restantes = rows.filter(
      (row) => !alvo.has(`${row.company}::${buildVmKey(row.filial, row.produto, row.cor)}`)
    );
    const removidos = rows.length - restantes.length;
    if (removidos > 0) writeJsonArray(VM_ITEMS_FILE, restantes);
    return removidos;
  }

  const sql = getNeonSql();
  await ensureTables(sql);

  let removidos = 0;
  for (const ref of refs) {
    const result = await sql`
      DELETE FROM vm_items
      WHERE company = ${ref.company}
        AND UPPER(TRIM(filial)) = ${normalizeVmValue(ref.filial).toUpperCase()}
        AND UPPER(TRIM(produto)) = ${normalizeVmValue(ref.produto).toUpperCase()}
        AND UPPER(TRIM(cor)) = ${normalizeVmValue(ref.cor).toUpperCase()}
      RETURNING produto
    `;
    if (Array.isArray(result)) removidos += result.length;
  }

  return removidos;
}

export interface VmMovimentoInput {
  company: CompanyKey;
  filial: string;
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  direcao: VmDirecao;
  romaneio: string | null;
  usuario: string | null;
  obs: string | null;
}

/** Registra o log de movimentos (não bloqueia o fluxo se falhar — quem chama decide). */
export async function logVmMovimentos(rows: VmMovimentoInput[]): Promise<void> {
  if (rows.length === 0) return;

  const criadoEm = new Date().toISOString();

  if (!hasPostgres()) {
    const existentes = readJsonArray<VmMovimento>(VM_MOVIMENTOS_FILE);
    let nextId = existentes.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
    const novos: VmMovimento[] = rows.map((row) => ({
      id: ++nextId,
      company: row.company,
      filial: normalizeVmValue(row.filial),
      produto: normalizeVmValue(row.produto),
      cor: normalizeVmValue(row.cor),
      descricao: normalizeVmValue(row.descricao),
      descCor: normalizeVmValue(row.descCor),
      direcao: row.direcao,
      romaneio: row.romaneio ? normalizeVmValue(row.romaneio) : null,
      usuario: row.usuario ? normalizeVmValue(row.usuario) : null,
      obs: row.obs ? normalizeVmValue(row.obs) : null,
      criadoEm,
    }));
    writeJsonArray(VM_MOVIMENTOS_FILE, [...existentes, ...novos]);
    return;
  }

  const sql = getNeonSql();
  await ensureTables(sql);

  for (const row of rows) {
    await sql`
      INSERT INTO vm_movimentos (
        company, filial, produto, cor, descricao, desc_cor,
        direcao, romaneio, usuario, obs, criado_em
      ) VALUES (
        ${row.company}, ${normalizeVmValue(row.filial)}, ${normalizeVmValue(row.produto)},
        ${normalizeVmValue(row.cor)}, ${normalizeVmValue(row.descricao)}, ${normalizeVmValue(row.descCor)},
        ${row.direcao}, ${row.romaneio}, ${row.usuario}, ${row.obs}, ${new Date(criadoEm)}
      )
    `;
  }
}

/** Últimos movimentos de VM da empresa (para o painel de histórico da página). */
export async function listVmMovimentos(
  company: CompanyKey,
  options?: { filiais?: string[] | null; limit?: number }
): Promise<VmMovimento[]> {
  const limit = Math.min(Math.max(Number(options?.limit ?? 50), 1), 500);
  const escopo = (options?.filiais ?? []).map((f) => normalizeVmValue(f)).filter(Boolean);
  const dentroDoEscopo = (filial: string) =>
    escopo.length === 0 || escopo.some((f) => f.toUpperCase() === filial.toUpperCase());

  if (!hasPostgres()) {
    return readJsonArray<VmMovimento>(VM_MOVIMENTOS_FILE)
      .filter((row) => row.company === company && dentroDoEscopo(row.filial))
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      .slice(0, limit);
  }

  const sql = getNeonSql();
  await ensureTables(sql);

  const rows = await sql`
    SELECT id, company, filial, produto, cor, descricao, desc_cor,
           direcao, romaneio, usuario, obs, criado_em
    FROM vm_movimentos
    WHERE company = ${company}
    ORDER BY criado_em DESC, id DESC
    LIMIT ${limit * 4}
  `;

  return rows
    .map((row) => ({
      id: Number(row.id),
      company: row.company as CompanyKey,
      filial: normalizeVmValue(row.filial),
      produto: normalizeVmValue(row.produto),
      cor: normalizeVmValue(row.cor),
      descricao: normalizeVmValue(row.descricao),
      descCor: normalizeVmValue(row.desc_cor),
      direcao: (row.direcao === "entrada" ? "entrada" : "saida") as VmDirecao,
      romaneio: row.romaneio ? normalizeVmValue(row.romaneio) : null,
      usuario: row.usuario ? normalizeVmValue(row.usuario) : null,
      obs: row.obs ? normalizeVmValue(row.obs) : null,
      criadoEm: toIso(row.criado_em),
    }))
    .filter((row) => dentroDoEscopo(row.filial))
    .slice(0, limit);
}
