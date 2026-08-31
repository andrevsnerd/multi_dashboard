/**
 * Persistência dos Gastos de Compra (lotes + orçamento mensal).
 *
 * Mesmo esquema do compra-salva-store: Neon quando há DATABASE_URL, arquivo
 * JSON em data/ quando não há (dev local sem banco). Dado próprio do dashboard
 * — nada disso existe no Linx.
 */

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import {
  COMPRA_GASTO_CANAIS,
  type CompraGastoCanal,
  type CompraGastoItem,
  type CompraGastoLote,
  type CompraGastoLoteInput,
  type CompraGastoOrcamentoEntry,
  type CompraGastoOrigem,
  type CompraGastoParcela,
  type CompraGastoTipo,
} from "@/lib/types/compra-gasto";

const FILE_PATH = path.join(process.cwd(), "data", "compra-gastos.json");

interface FileShape {
  lotes: CompraGastoLote[];
  orcamento: (CompraGastoOrcamentoEntry & { companyKey: string })[];
}

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;

/**
 * `CREATE TABLE IF NOT EXISTS` NÃO é atômico contra criação concorrente: dois
 * pedidos simultâneos (o GET do painel busca lotes e orçamento em paralelo)
 * disparam o DDL ao mesmo tempo e um deles morre com unique violation em
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

/**
 * Migração preguiçosa, uma única vez por processo. A promessa é memoizada para
 * que chamadas concorrentes esperem a MESMA execução em vez de rodarem o DDL
 * em paralelo; se falhar, a memoização é limpa para a próxima tentativa.
 */
async function ensureTable(): Promise<void> {
  if (tableChecked) return;
  if (!ensurePromise) {
    ensurePromise = runMigrations()
      .then(() => {
        tableChecked = true;
      })
      .catch((erro) => {
        ensurePromise = null;
        throw erro;
      });
  }
  return ensurePromise;
}

async function runMigrations(): Promise<void> {
  const sql = getNeonSql();
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS compra_gastos_lotes (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      codigo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      colecao TEXT,
      fornecedor TEXT,
      tipo TEXT NOT NULL DEFAULT 'mercadoria',
      origem TEXT NOT NULL DEFAULT 'valor',
      compra_salva_id TEXT,
      data_compra DATE NOT NULL,
      chegada_ini DATE,
      chegada_real DATE,
      estimado BOOLEAN NOT NULL DEFAULT false,
      valor_unico NUMERIC(14, 2),
      observacao TEXT,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      parcelas JSONB NOT NULL DEFAULT '[]'::jsonb,
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // A fonte das compras passou a ser a Compra em trânsito CONFIRMADA (antes era a
  // Compra Salva). `compra_salva_id` fica no schema porque os lotes já gravados
  // continuam apontando para lá — nenhum lote novo escreve nessa coluna.
  await ddl(() => sql`ALTER TABLE compra_gastos_lotes ADD COLUMN IF NOT EXISTS compra_transito_id TEXT`);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS compra_gastos_lotes_transito_idx
      ON compra_gastos_lotes (company_key, compra_transito_id)
  `);
  // Janela de chegada (chegada_fim) e data de PDV saíram do produto: a compra
  // tem data e previsão de chegada, nada mais. Drop idempotente para o schema
  // não carregar coluna que nenhuma tela preenche.
  await ddl(() => sql`ALTER TABLE compra_gastos_lotes DROP COLUMN IF EXISTS chegada_fim`);
  await ddl(() => sql`ALTER TABLE compra_gastos_lotes DROP COLUMN IF EXISTS pdv`);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS compra_gastos_lotes_company_idx
      ON compra_gastos_lotes (company_key)
  `);
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS compra_gastos_orcamento (
      company_key TEXT NOT NULL,
      ym TEXT NOT NULL,
      valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
      observacao TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_key, ym)
    )
  `);
}

async function ensureDataFile() {
  const dir = path.join(process.cwd(), "data");
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify({ lotes: [], orcamento: [] }, null, 2), "utf-8");
  }
}

async function readFileAll(): Promise<FileShape> {
  await ensureDataFile();
  try {
    const parsed = JSON.parse(await fs.readFile(FILE_PATH, "utf-8")) as FileShape;
    return {
      lotes: Array.isArray(parsed?.lotes) ? parsed.lotes : [],
      orcamento: Array.isArray(parsed?.orcamento) ? parsed.orcamento : [],
    };
  } catch {
    return { lotes: [], orcamento: [] };
  }
}

async function writeFileAll(data: FileShape) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ───────────────────────── normalização ─────────────────────────

const TIPOS: CompraGastoTipo[] = ["mercadoria", "frete", "adiantamento", "material", "outros"];
// "salva" é legado: nenhum lote novo nasce dela, mas os já gravados precisam
// continuar sendo lidos com a própria origem em vez de cair no fallback.
const ORIGENS: CompraGastoOrigem[] = ["transito", "itens", "valor", "salva"];

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s ? s.slice(0, 10) : null;
}

export function normalizeItem(raw: Partial<CompraGastoItem>): CompraGastoItem {
  return {
    descricao: String(raw?.descricao ?? "").trim(),
    produto: raw?.produto ? String(raw.produto).trim() : null,
    corProduto: raw?.corProduto ? String(raw.corProduto).trim() : null,
    corDescricao: raw?.corDescricao ? String(raw.corDescricao).trim() : null,
    qtd: num(raw?.qtd),
    custoUnitario: num(raw?.custoUnitario),
  };
}

export function normalizeParcela(raw: Partial<CompraGastoParcela>, i: number): CompraGastoParcela {
  const canal = raw?.canal as CompraGastoCanal | undefined;
  return {
    numero: Number(raw?.numero) > 0 ? Math.round(Number(raw.numero)) : i + 1,
    vencimento: dateOnly(raw?.vencimento) ?? "",
    valor: num(raw?.valor),
    pago: !!raw?.pago,
    dataPagamento: dateOnly(raw?.dataPagamento),
    // Canal e etapa vêm do modelo de pagamento (China = transferência + Alibaba).
    // Valor desconhecido cai para null em vez de entrar no banco como lixo.
    canal: canal && COMPRA_GASTO_CANAIS.includes(canal) ? canal : null,
    etapa: raw?.etapa ? String(raw.etapa).trim().slice(0, 80) : null,
  };
}

function rowToLote(row: Record<string, unknown>): CompraGastoLote {
  const itens = Array.isArray(row.itens) ? (row.itens as CompraGastoItem[]) : [];
  const parcelas = Array.isArray(row.parcelas) ? (row.parcelas as CompraGastoParcela[]) : [];
  return {
    id: String(row.id),
    companyKey: String(row.company_key),
    codigo: String(row.codigo ?? ""),
    titulo: String(row.titulo ?? ""),
    colecao: (row.colecao as string) ?? null,
    fornecedor: (row.fornecedor as string) ?? null,
    tipo: (TIPOS.includes(row.tipo as CompraGastoTipo) ? row.tipo : "mercadoria") as CompraGastoTipo,
    origem: (ORIGENS.includes(row.origem as CompraGastoOrigem) ? row.origem : "valor") as CompraGastoOrigem,
    compraTransitoId: (row.compra_transito_id as string) ?? null,
    compraSalvaId: (row.compra_salva_id as string) ?? null,
    dataCompra: dateOnly(row.data_compra) ?? "",
    chegadaIni: dateOnly(row.chegada_ini),
    chegadaReal: dateOnly(row.chegada_real),
    estimado: !!row.estimado,
    valorUnico: row.valor_unico != null ? num(row.valor_unico) : null,
    observacao: (row.observacao as string) ?? null,
    itens: itens.map(normalizeItem),
    parcelas: parcelas.map(normalizeParcela),
    criadoPor: (row.criado_por as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

// ───────────────────────── lotes ─────────────────────────

/**
 * Já existe compra lançada a partir desta Compra em trânsito?
 *
 * A tela esconde do select o que já foi lançado, mas a trava real é aqui: duas
 * abas abertas (ou um duplo-clique) lançariam a MESMA compra duas vezes e o
 * comprometido do mês contaria o mesmo dinheiro em dobro.
 */
export async function existeLoteDaCompraTransito(
  companyKey: string,
  compraTransitoId: string
): Promise<boolean> {
  if (!compraTransitoId) return false;

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT 1
      FROM compra_gastos_lotes
      WHERE company_key = ${companyKey} AND compra_transito_id = ${compraTransitoId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  const all = await readFileAll();
  return all.lotes.some(
    (l) => l.companyKey === companyKey && l.compraTransitoId === compraTransitoId
  );
}

export async function listLotes(companyKey: string): Promise<CompraGastoLote[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT
        id, company_key, codigo, titulo, colecao, fornecedor, tipo, origem,
        compra_transito_id, compra_salva_id,
        data_compra, chegada_ini, chegada_real, estimado, valor_unico,
        observacao, itens, parcelas, criado_por, created_at, updated_at
      FROM compra_gastos_lotes
      WHERE company_key = ${companyKey}
      ORDER BY data_compra DESC, created_at DESC
    `;
    return rows.map((r) => rowToLote(r as Record<string, unknown>));
  }

  const all = await readFileAll();
  return all.lotes
    .filter((l) => l.companyKey === companyKey)
    .sort((a, b) => (a.dataCompra < b.dataCompra ? 1 : a.dataCompra > b.dataCompra ? -1 : 0));
}

export async function getLote(companyKey: string, id: string): Promise<CompraGastoLote | null> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT
        id, company_key, codigo, titulo, colecao, fornecedor, tipo, origem,
        compra_transito_id, compra_salva_id,
        data_compra, chegada_ini, chegada_real, estimado, valor_unico,
        observacao, itens, parcelas, criado_por, created_at, updated_at
      FROM compra_gastos_lotes
      WHERE id = ${id} AND company_key = ${companyKey}
      LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? rowToLote(row) : null;
  }

  const all = await readFileAll();
  return all.lotes.find((l) => l.id === id && l.companyKey === companyKey) ?? null;
}

export async function createLote(
  companyKey: string,
  input: CompraGastoLoteInput,
  criadoPor?: string | null
): Promise<CompraGastoLote> {
  const now = new Date().toISOString();
  const lote: CompraGastoLote = {
    id: randomUUID(),
    companyKey,
    codigo: String(input.codigo ?? "").trim(),
    titulo: String(input.titulo ?? "").trim(),
    colecao: input.colecao ? String(input.colecao).trim() : null,
    fornecedor: input.fornecedor ? String(input.fornecedor).trim() : null,
    tipo: TIPOS.includes(input.tipo) ? input.tipo : "mercadoria",
    origem: ORIGENS.includes(input.origem) ? input.origem : "valor",
    compraTransitoId: input.compraTransitoId ? String(input.compraTransitoId) : null,
    compraSalvaId: input.compraSalvaId ? String(input.compraSalvaId) : null,
    dataCompra: dateOnly(input.dataCompra) ?? now.slice(0, 10),
    chegadaIni: dateOnly(input.chegadaIni),
    chegadaReal: dateOnly(input.chegadaReal),
    estimado: !!input.estimado,
    valorUnico: input.valorUnico != null ? num(input.valorUnico) : null,
    observacao: input.observacao ? String(input.observacao).trim() : null,
    itens: (input.itens ?? []).map(normalizeItem),
    parcelas: (input.parcelas ?? []).map(normalizeParcela),
    criadoPor: criadoPor ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compra_gastos_lotes (
        id, company_key, codigo, titulo, colecao, fornecedor, tipo, origem,
        compra_transito_id, compra_salva_id,
        data_compra, chegada_ini, chegada_real, estimado, valor_unico,
        observacao, itens, parcelas, criado_por, created_at, updated_at
      ) VALUES (
        ${lote.id}, ${lote.companyKey}, ${lote.codigo}, ${lote.titulo}, ${lote.colecao},
        ${lote.fornecedor}, ${lote.tipo}, ${lote.origem},
        ${lote.compraTransitoId}, ${lote.compraSalvaId},
        ${lote.dataCompra}, ${lote.chegadaIni}, ${lote.chegadaReal},
        ${lote.estimado}, ${lote.valorUnico}, ${lote.observacao},
        ${JSON.stringify(lote.itens)}::jsonb, ${JSON.stringify(lote.parcelas)}::jsonb,
        ${lote.criadoPor}, ${lote.createdAt}, ${lote.updatedAt}
      )
    `;
    return lote;
  }

  const all = await readFileAll();
  all.lotes.push(lote);
  await writeFileAll(all);
  return lote;
}

export async function updateLote(
  companyKey: string,
  id: string,
  patch: Partial<CompraGastoLoteInput>
): Promise<CompraGastoLote | null> {
  const atual = await getLote(companyKey, id);
  if (!atual) return null;

  const proximo: CompraGastoLote = {
    ...atual,
    codigo: patch.codigo != null ? String(patch.codigo).trim() : atual.codigo,
    titulo: patch.titulo != null ? String(patch.titulo).trim() : atual.titulo,
    colecao: patch.colecao !== undefined ? (patch.colecao ? String(patch.colecao).trim() : null) : atual.colecao,
    fornecedor:
      patch.fornecedor !== undefined
        ? patch.fornecedor
          ? String(patch.fornecedor).trim()
          : null
        : atual.fornecedor,
    tipo: patch.tipo && TIPOS.includes(patch.tipo) ? patch.tipo : atual.tipo,
    origem: patch.origem && ORIGENS.includes(patch.origem) ? patch.origem : atual.origem,
    compraTransitoId:
      patch.compraTransitoId !== undefined
        ? (patch.compraTransitoId ?? null)
        : atual.compraTransitoId,
    compraSalvaId:
      patch.compraSalvaId !== undefined ? (patch.compraSalvaId ?? null) : atual.compraSalvaId,
    dataCompra: patch.dataCompra !== undefined ? dateOnly(patch.dataCompra) ?? atual.dataCompra : atual.dataCompra,
    chegadaIni: patch.chegadaIni !== undefined ? dateOnly(patch.chegadaIni) : atual.chegadaIni,
    chegadaReal: patch.chegadaReal !== undefined ? dateOnly(patch.chegadaReal) : atual.chegadaReal,
    estimado: patch.estimado !== undefined ? !!patch.estimado : atual.estimado,
    valorUnico:
      patch.valorUnico !== undefined ? (patch.valorUnico != null ? num(patch.valorUnico) : null) : atual.valorUnico,
    observacao:
      patch.observacao !== undefined ? (patch.observacao ? String(patch.observacao).trim() : null) : atual.observacao,
    itens: patch.itens !== undefined ? patch.itens.map(normalizeItem) : atual.itens,
    parcelas: patch.parcelas !== undefined ? patch.parcelas.map(normalizeParcela) : atual.parcelas,
    updatedAt: new Date().toISOString(),
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      UPDATE compra_gastos_lotes SET
        codigo = ${proximo.codigo},
        titulo = ${proximo.titulo},
        colecao = ${proximo.colecao},
        fornecedor = ${proximo.fornecedor},
        tipo = ${proximo.tipo},
        origem = ${proximo.origem},
        compra_transito_id = ${proximo.compraTransitoId},
        compra_salva_id = ${proximo.compraSalvaId},
        data_compra = ${proximo.dataCompra},
        chegada_ini = ${proximo.chegadaIni},
        chegada_real = ${proximo.chegadaReal},
        estimado = ${proximo.estimado},
        valor_unico = ${proximo.valorUnico},
        observacao = ${proximo.observacao},
        itens = ${JSON.stringify(proximo.itens)}::jsonb,
        parcelas = ${JSON.stringify(proximo.parcelas)}::jsonb,
        updated_at = ${proximo.updatedAt}
      WHERE id = ${id} AND company_key = ${companyKey}
    `;
    return proximo;
  }

  const all = await readFileAll();
  const i = all.lotes.findIndex((l) => l.id === id && l.companyKey === companyKey);
  if (i < 0) return null;
  all.lotes[i] = proximo;
  await writeFileAll(all);
  return proximo;
}

export async function deleteLote(companyKey: string, id: string): Promise<boolean> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      DELETE FROM compra_gastos_lotes
      WHERE id = ${id} AND company_key = ${companyKey}
      RETURNING id
    `;
    return rows.length > 0;
  }

  const all = await readFileAll();
  const antes = all.lotes.length;
  all.lotes = all.lotes.filter((l) => !(l.id === id && l.companyKey === companyKey));
  if (all.lotes.length === antes) return false;
  await writeFileAll(all);
  return true;
}

// ───────────────────────── orçamento ─────────────────────────

export async function listOrcamento(companyKey: string): Promise<CompraGastoOrcamentoEntry[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT ym, valor, observacao, updated_by, updated_at
      FROM compra_gastos_orcamento
      WHERE company_key = ${companyKey}
      ORDER BY ym ASC
    `;
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        ym: String(row.ym),
        valor: num(row.valor),
        observacao: (row.observacao as string) ?? null,
        updatedBy: (row.updated_by as string) ?? null,
        updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
      };
    });
  }

  const all = await readFileAll();
  return all.orcamento
    .filter((o) => o.companyKey === companyKey)
    .map(({ ym, valor, observacao, updatedBy, updatedAt }) => ({
      ym,
      valor,
      observacao: observacao ?? null,
      updatedBy: updatedBy ?? null,
      updatedAt: updatedAt ?? null,
    }))
    .sort((a, b) => a.ym.localeCompare(b.ym));
}

/** Grava (ou remove, quando valor <= 0 e sem observação) o orçamento de um mês. */
export async function setOrcamento(
  companyKey: string,
  ym: string,
  valor: number,
  updatedBy?: string | null,
  observacao?: string | null
): Promise<CompraGastoOrcamentoEntry> {
  const mes = String(ym ?? "").slice(0, 7);
  const v = num(valor);
  const now = new Date().toISOString();
  const obs = observacao ? String(observacao).trim() : null;

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compra_gastos_orcamento (company_key, ym, valor, observacao, updated_by, updated_at)
      VALUES (${companyKey}, ${mes}, ${v}, ${obs}, ${updatedBy ?? null}, ${now})
      ON CONFLICT (company_key, ym) DO UPDATE
        SET valor = EXCLUDED.valor,
            observacao = EXCLUDED.observacao,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
    `;
    return { ym: mes, valor: v, observacao: obs, updatedBy: updatedBy ?? null, updatedAt: now };
  }

  const all = await readFileAll();
  const i = all.orcamento.findIndex((o) => o.companyKey === companyKey && o.ym === mes);
  const entry = {
    companyKey,
    ym: mes,
    valor: v,
    observacao: obs,
    updatedBy: updatedBy ?? null,
    updatedAt: now,
  };
  if (i < 0) all.orcamento.push(entry);
  else all.orcamento[i] = entry;
  await writeFileAll(all);
  return { ym: mes, valor: v, observacao: obs, updatedBy: updatedBy ?? null, updatedAt: now };
}

export async function deleteOrcamento(companyKey: string, ym: string): Promise<boolean> {
  const mes = String(ym ?? "").slice(0, 7);
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      DELETE FROM compra_gastos_orcamento
      WHERE company_key = ${companyKey} AND ym = ${mes}
      RETURNING ym
    `;
    return rows.length > 0;
  }

  const all = await readFileAll();
  const antes = all.orcamento.length;
  all.orcamento = all.orcamento.filter((o) => !(o.companyKey === companyKey && o.ym === mes));
  if (all.orcamento.length === antes) return false;
  await writeFileAll(all);
  return true;
}
