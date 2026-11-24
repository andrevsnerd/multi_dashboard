import "server-only";

import { randomUUID } from "crypto";
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
 * romaneio em edição × TELA) — ele É a lista daquela tela, não uma cópia. Ao
 * registrar o romaneio com sucesso o rascunho é apagado; enquanto não for
 * registrado, aparece na aba "Rascunhos".
 *
 * `romaneioEdicao` separa dois trabalhos que acontecem na MESMA filial e no
 * mesmo tipo: montar um romaneio novo (vazio) e acrescentar itens a um romaneio
 * de entrada já gravado. Sem essa dimensão os dois disputariam a mesma chave e
 * um apagaria o outro.
 *
 * DUAS TELAS AO MESMO TEMPO (24/11/2026) — nada de uma pode sumir por causa da
 * outra:
 * - `tela`: cada aba do navegador tem a sua chave. Duas telas (mesmo login em
 *   dois computadores, ou duas abas) nunca gravam por cima uma da outra.
 * - `lista_id`: identifica a lista. Quem assume ou descarta a lista de OUTRA
 *   tela deixa um EVENTO com o `lista_id` e a foto dos itens. A tela dona, ao
 *   gravar de novo (ou no sinal de vida), recebe o evento em vez de recriar o
 *   rascunho calada — e desconta da tela só o que foi levado.
 * - `visto_em`: sinal de vida da tela dona. Lista com a tela aberta e mexida há
 *   pouco é "em uso": ninguém mais assume nem descarta.
 */

const DATA_FILE = path.join(process.cwd(), "data", "saida-entrada-rascunhos.json");
const EVENTOS_FILE = path.join(process.cwd(), "data", "saida-entrada-rascunhos-eventos.json");

/** Sem sinal de vida da tela há mais que isso = a tela foi fechada (ou dormiu). */
export const TELA_VIVA_MS = 90_000;
/** Tela aberta, mas sem mexer na lista há mais que isso = parada (pode ser assumida). */
export const LISTA_PARADA_MS = 30 * 60_000;

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
  /** Peça P/M/G: posição da grade escolhida (null = ainda não escolhida). */
  tamanho?: number | null;
  /** Rótulo do tamanho (P/M/G…), só para exibir. */
  tamanhoLabel?: string | null;
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
  /** Aba do navegador dona do rascunho (null = rascunho antigo, de antes das telas). */
  tela: string | null;
  /** Identidade da lista (muda quando a lista é assumida por outra tela). */
  listaId: string | null;
  /** Último sinal de vida da tela dona. */
  vistoEm: string | null;
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
  tela?: string | null;
  listaId?: string | null;
  itens: RascunhoItem[];
}

/** O que outra tela fez com a lista: assumiu (levou) ou descartou. */
export interface RascunhoEvento {
  listaId: string;
  acao: "assumido" | "descartado";
  por: string;
  em: string;
  itens: RascunhoItem[];
  observacao: string;
}

export type SalvarRascunhoResultado =
  | { status: "ok"; rascunho: SaidaEntradaRascunho }
  | { status: "removido" }
  /** A lista foi levada/descartada por outra tela: NÃO foi recriada. */
  | { status: "evento"; evento: RascunhoEvento }
  /** A chave tem OUTRA lista (ex.: retomada nesta tela): nada foi gravado. */
  | { status: "conflito"; atual: SaidaEntradaRascunho };

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
  romaneioEdicao?: string | null,
  tela?: string | null
): string {
  const base = [
    norm(companyKey).toLowerCase(),
    norm(username).toLowerCase(),
    norm(tipoOperacao).toLowerCase(),
    norm(filial).toUpperCase(),
  ].join("::");
  // Sufixos só quando existem: as chaves antigas continuam válidas.
  const romaneio = norm(romaneioEdicao).toUpperCase();
  const comRomaneio = romaneio ? `${base}::R${romaneio}` : base;
  const t = norm(tela);
  return t ? `${comRomaneio}::T${t}` : comRomaneio;
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
        tamanho: Number.isInteger(Number(item.tamanho)) && Number(item.tamanho) > 0 ? Number(item.tamanho) : null,
        tamanhoLabel: norm(item.tamanhoLabel) || null,
      };
    })
    .filter((item) => item.produto.length > 0);
}

function chaveItem(item: RascunhoItem): string {
  return `${item.produto}|${item.corProduto ?? ""}|${item.tamanho ?? ""}`;
}

/** Junta duas listas DIFERENTES de trabalho: mesma peça soma a quantidade. */
function somarItens(a: RascunhoItem[], b: RascunhoItem[]): RascunhoItem[] {
  const out = a.map((i) => ({ ...i }));
  for (const item of b) {
    const idx = out.findIndex((o) => chaveItem(o) === chaveItem(item));
    if (idx === -1) out.push({ ...item });
    else out[idx] = { ...out[idx], quantidade: out[idx].quantidade + item.quantidade };
  }
  return out;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toIso(value);
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function rowToRascunho(row: Record<string, unknown>): SaidaEntradaRascunho {
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
    tela: norm(row.tela) || null,
    listaId: norm(row.lista_id) || null,
    vistoEm: toIsoOrNull(row.visto_em),
    itens: sanitizeItens(parseJson(row.itens)),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToEvento(row: Record<string, unknown>): RascunhoEvento {
  return {
    listaId: norm(row.lista_id),
    acao: norm(row.acao) === "descartado" ? "descartado" : "assumido",
    por: norm(row.por),
    em: toIso(row.em),
    itens: sanitizeItens(parseJson(row.itens)),
    observacao: norm(row.observacao),
  };
}

/**
 * A tela dona está com a lista aberta e mexendo nela agora? Então ninguém mais
 * assume nem descarta — senão a lista some da mão de quem está bipando.
 */
export function rascunhoEmUso(r: Pick<SaidaEntradaRascunho, "vistoEm" | "updatedAt">, agora = Date.now()): boolean {
  if (!r.vistoEm) return false;
  const visto = new Date(r.vistoEm).getTime();
  const mexido = new Date(r.updatedAt).getTime();
  return agora - visto <= TELA_VIVA_MS && agora - mexido <= LISTA_PARADA_MS;
}

// ─────────────────────── fallback em arquivo ───────────────────────
// Só para o ambiente local sem Neon (um processo, sem concorrência real).

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFileRascunhos(): SaidaEntradaRascunho[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed)
      ? parsed.map((r) => ({ tela: null, listaId: null, vistoEm: null, ...r }))
      : [];
  } catch {
    return [];
  }
}

function writeFileRascunhos(rows: SaidaEntradaRascunho[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

function readFileEventos(): RascunhoEvento[] {
  ensureDataDir();
  if (!fs.existsSync(EVENTOS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(EVENTOS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileEventos(rows: RascunhoEvento[]) {
  ensureDataDir();
  fs.writeFileSync(EVENTOS_FILE, JSON.stringify(rows, null, 2), "utf-8");
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
  // Duas telas ao mesmo tempo (24/11/2026).
  await ddl(() => sql`ALTER TABLE saida_entrada_rascunhos ADD COLUMN IF NOT EXISTS tela TEXT`);
  await ddl(() => sql`ALTER TABLE saida_entrada_rascunhos ADD COLUMN IF NOT EXISTS lista_id TEXT`);
  await ddl(() => sql`ALTER TABLE saida_entrada_rascunhos ADD COLUMN IF NOT EXISTS visto_em TIMESTAMPTZ`);
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS saida_entrada_rascunhos_eventos (
      lista_id TEXT PRIMARY KEY,
      rascunho_id TEXT NOT NULL,
      acao TEXT NOT NULL,
      por TEXT NOT NULL,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      observacao TEXT NOT NULL DEFAULT '',
      em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

// ─────────────────────────── eventos ───────────────────────────

async function buscarEvento(listaId: string | null | undefined): Promise<RascunhoEvento | null> {
  const key = norm(listaId);
  if (!key) return null;
  if (!hasPostgres()) return readFileEventos().find((e) => e.listaId === key) ?? null;
  const sql = getNeonSql();
  await ensureTable();
  const rows = await sql`SELECT * FROM saida_entrada_rascunhos_eventos WHERE lista_id = ${key} LIMIT 1`;
  return rows.length > 0 ? rowToEvento(rows[0] as Record<string, unknown>) : null;
}

/**
 * Anota o evento ANTES de tirar o rascunho do lugar: um PUT da tela dona que
 * começar depois disso não recria a lista (ver `salvarRascunho`). Devolve false
 * se a lista já tinha evento (outra pessoa chegou antes).
 */
async function anotarEvento(
  listaId: string,
  rascunhoIdValor: string,
  acao: RascunhoEvento["acao"],
  por: string
): Promise<boolean> {
  if (!hasPostgres()) {
    const eventos = readFileEventos();
    if (eventos.some((e) => e.listaId === listaId)) return false;
    eventos.push({ listaId, acao, por, em: new Date().toISOString(), itens: [], observacao: "" });
    writeFileEventos(eventos);
    return true;
  }
  const sql = getNeonSql();
  await ensureTable();
  // Faxina: evento só serve enquanto a tela dona pode voltar.
  await sql`DELETE FROM saida_entrada_rascunhos_eventos WHERE em < NOW() - INTERVAL '30 days'`;
  const rows = await sql`
    INSERT INTO saida_entrada_rascunhos_eventos (lista_id, rascunho_id, acao, por)
    VALUES (${listaId}, ${rascunhoIdValor}, ${acao}, ${por})
    ON CONFLICT (lista_id) DO NOTHING
    RETURNING lista_id
  `;
  return rows.length > 0;
}

async function completarEvento(listaId: string, itens: RascunhoItem[], observacao: string): Promise<void> {
  if (!hasPostgres()) {
    const eventos = readFileEventos();
    const idx = eventos.findIndex((e) => e.listaId === listaId);
    if (idx >= 0) {
      eventos[idx] = { ...eventos[idx], itens, observacao };
      writeFileEventos(eventos);
    }
    return;
  }
  const sql = getNeonSql();
  await sql`
    UPDATE saida_entrada_rascunhos_eventos
       SET itens = ${JSON.stringify(itens)}::jsonb, observacao = ${observacao}
     WHERE lista_id = ${listaId}
  `;
}

async function desfazerEvento(listaId: string): Promise<void> {
  if (!hasPostgres()) {
    writeFileEventos(readFileEventos().filter((e) => e.listaId !== listaId));
    return;
  }
  const sql = getNeonSql();
  await sql`DELETE FROM saida_entrada_rascunhos_eventos WHERE lista_id = ${listaId}`;
}

// ─────────────────────────── API ───────────────────────────

/**
 * Grava (ou substitui) o rascunho da tela. Lista vazia apaga o rascunho — sem
 * isso "Limpar lista" deixaria um fantasma na aba.
 *
 * Com `listaId`, a gravação só vale para AQUELA lista: se outra tela assumiu ou
 * descartou a lista, devolve o evento (e não recria nada); se a chave guarda
 * outra lista, devolve conflito (e não sobrescreve nada).
 */
export async function salvarRascunho(input: SalvarRascunhoInput): Promise<SalvarRascunhoResultado> {
  const companyKey = norm(input.companyKey);
  const username = norm(input.username);
  const tipoOperacao: TipoOperacaoRascunho = input.tipoOperacao === "entrada" ? "entrada" : "saida";
  const filial = norm(input.filial);

  if (!companyKey || !username || !filial) return { status: "removido" };

  const itens = sanitizeItens(input.itens);
  const romaneioEdicao = norm(input.romaneioEdicao) || null;
  const tela = norm(input.tela) || null;
  const listaId = norm(input.listaId) || null;
  const id = rascunhoId(companyKey, username, tipoOperacao, filial, romaneioEdicao, tela);

  const filialLabel = norm(input.filialLabel) || filial;
  const filialDestino = norm(input.filialDestino) || null;
  const filialDestinoLabel = norm(input.filialDestinoLabel) || filialDestino;
  const tipoRomaneio = norm(input.tipoRomaneio);
  const observacao = norm(input.observacao);

  if (!hasPostgres()) {
    const evento = await buscarEvento(listaId);
    if (evento) return { status: "evento", evento };
    const rows = readFileRascunhos();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0 && listaId && rows[idx].listaId && rows[idx].listaId !== listaId) {
      return { status: "conflito", atual: rows[idx] };
    }
    if (itens.length === 0) {
      if (idx >= 0) {
        rows.splice(idx, 1);
        writeFileRascunhos(rows);
      }
      return { status: "removido" };
    }
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
      tela,
      listaId,
      vistoEm: agora,
      itens,
      createdAt: idx >= 0 ? rows[idx].createdAt : agora,
      updatedAt: agora,
    };
    if (idx >= 0) rows[idx] = registro;
    else rows.push(registro);
    writeFileRascunhos(rows);
    return { status: "ok", rascunho: registro };
  }

  const sql = getNeonSql();
  await ensureTable();

  if (itens.length === 0) {
    // Só apaga a MESMA lista: uma lista vazia velha não leva embora outra que
    // tenha sido retomada nesta chave.
    await sql`
      DELETE FROM saida_entrada_rascunhos
       WHERE id = ${id}
         AND (${listaId}::text IS NULL OR lista_id IS NULL OR lista_id = ${listaId})
    `;
    const evento = await buscarEvento(listaId);
    return evento ? { status: "evento", evento } : { status: "removido" };
  }

  // UM comando, uma foto do banco: se o evento já existe, não insere; se a chave
  // tem outra lista, não atualiza. `anotarEvento` grava o evento ANTES de tirar
  // a linha, então não há janela em que o PUT recrie a lista levada.
  const result = await sql`
    INSERT INTO saida_entrada_rascunhos (
      id, company_key, username, tipo_operacao, filial, filial_label,
      filial_destino, filial_destino_label, tipo_romaneio, observacao,
      romaneio_edicao, tela, lista_id, visto_em, itens, updated_at
    )
    SELECT
      ${id}, ${companyKey}, ${username}, ${tipoOperacao}, ${filial}, ${filialLabel},
      ${filialDestino}, ${filialDestinoLabel}, ${tipoRomaneio}, ${observacao},
      ${romaneioEdicao}, ${tela}, ${listaId}, NOW(), ${JSON.stringify(itens)}::jsonb, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM saida_entrada_rascunhos_eventos e
       WHERE ${listaId}::text IS NOT NULL AND e.lista_id = ${listaId}
    )
    ON CONFLICT (id) DO UPDATE SET
      filial_label = EXCLUDED.filial_label,
      filial_destino = EXCLUDED.filial_destino,
      filial_destino_label = EXCLUDED.filial_destino_label,
      tipo_romaneio = EXCLUDED.tipo_romaneio,
      observacao = EXCLUDED.observacao,
      romaneio_edicao = EXCLUDED.romaneio_edicao,
      tela = EXCLUDED.tela,
      lista_id = COALESCE(EXCLUDED.lista_id, saida_entrada_rascunhos.lista_id),
      visto_em = NOW(),
      itens = EXCLUDED.itens,
      updated_at = NOW()
    WHERE EXCLUDED.lista_id IS NULL
       OR saida_entrada_rascunhos.lista_id IS NULL
       OR saida_entrada_rascunhos.lista_id = EXCLUDED.lista_id
    RETURNING *
  `;

  if (result.length > 0) {
    return { status: "ok", rascunho: rowToRascunho(result[0] as Record<string, unknown>) };
  }

  const evento = await buscarEvento(listaId);
  if (evento) return { status: "evento", evento };
  const atual = await buscarRascunho(id);
  if (atual) return { status: "conflito", atual };
  // Corrida rara (a linha sumiu entre os dois comandos): tenta de novo do zero.
  return salvarRascunho(input);
}

/**
 * Sinal de vida da tela dona. Também é a conferência de posse: se outra tela
 * levou ou descartou a lista, devolve o evento.
 */
export async function marcarVisto(
  id: string,
  listaId: string
): Promise<{ status: "ok" } | { status: "ausente" } | { status: "evento"; evento: RascunhoEvento }> {
  const key = norm(id);
  const lista = norm(listaId);
  if (!key || !lista) return { status: "ausente" };

  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    const idx = rows.findIndex((r) => r.id === key && r.listaId === lista);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], vistoEm: new Date().toISOString() };
      writeFileRascunhos(rows);
      return { status: "ok" };
    }
  } else {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`
      UPDATE saida_entrada_rascunhos SET visto_em = NOW()
       WHERE id = ${key} AND lista_id = ${lista}
      RETURNING id
    `;
    if (rows.length > 0) return { status: "ok" };
  }

  const evento = await buscarEvento(lista);
  return evento ? { status: "evento", evento } : { status: "ausente" };
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

/** Apaga o rascunho da PRÓPRIA tela (romaneio registrado). */
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

/**
 * Tira o rascunho do lugar e devolve o que ele era (DELETE … RETURNING). Só tira
 * a MESMA lista que foi lida. Dois "assumir" ao mesmo tempo: só um recebe.
 */
async function retirarRascunho(id: string, listaId: string | null): Promise<SaidaEntradaRascunho | null> {
  const key = norm(id);
  if (!key) return null;

  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    const idx = rows.findIndex((r) => r.id === key && (r.listaId ?? null) === listaId);
    if (idx < 0) return null;
    const [retirado] = rows.splice(idx, 1);
    writeFileRascunhos(rows);
    return retirado;
  }

  const sql = getNeonSql();
  await ensureTable();
  const rows = await sql`
    DELETE FROM saida_entrada_rascunhos
     WHERE id = ${key} AND lista_id IS NOT DISTINCT FROM ${listaId}::text
    RETURNING *
  `;
  return rows.length > 0 ? rowToRascunho(rows[0] as Record<string, unknown>) : null;
}

/** Volta um rascunho retirado exatamente como era (desfaz um "assumir" que falhou). */
async function devolverRascunho(r: SaidaEntradaRascunho): Promise<void> {
  if (!hasPostgres()) {
    const rows = readFileRascunhos();
    if (!rows.some((x) => x.id === r.id)) {
      rows.push(r);
      writeFileRascunhos(rows);
    }
    return;
  }
  const sql = getNeonSql();
  await sql`
    INSERT INTO saida_entrada_rascunhos (
      id, company_key, username, tipo_operacao, filial, filial_label,
      filial_destino, filial_destino_label, tipo_romaneio, observacao,
      romaneio_edicao, tela, lista_id, visto_em, itens, created_at, updated_at
    ) VALUES (
      ${r.id}, ${r.companyKey}, ${r.username}, ${r.tipoOperacao}, ${r.filial}, ${r.filialLabel},
      ${r.filialDestino}, ${r.filialDestinoLabel}, ${r.tipoRomaneio}, ${r.observacao},
      ${r.romaneioEdicao}, ${r.tela}, ${r.listaId}, ${r.vistoEm}, ${JSON.stringify(r.itens)}::jsonb,
      ${r.createdAt}, ${r.updatedAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export type AssumirRascunhoResultado =
  | {
      ok: true;
      rascunho: SaidaEntradaRascunho;
      /** Dono anterior, quando veio de outra pessoa. */
      deUsuario: string | null;
      /** A lista já era desta tela: nada mudou de lugar. */
      jaEraDaTela: boolean;
      /** A tela já tinha lista nesta filial: os itens foram SOMADOS a ela. */
      somado: boolean;
      /** Só o que veio da outra tela (a tela soma isto à lista que tem na mão). */
      itensAssumidos: RascunhoItem[];
    }
  | { ok: false; motivo: "inexistente" }
  | { ok: false; motivo: "em_uso"; usuario: string; vistoEm: string | null };

/**
 * "Retomar" um rascunho, decidido no SERVIDOR.
 *
 * A tela guardava a lista da aba desde a última leitura e retomava essa cópia:
 * se o dono já tinha registrado o romaneio, a cópia velha voltava como lista
 * nova e virava outro romaneio com os mesmos itens (836272 × 836273, NERD,
 * 28/10/2026). Aqui o rascunho é relido na hora — se não existe mais, não volta.
 *
 * Lista de OUTRA tela (outra pessoa, ou a mesma pessoa em outro computador) é
 * TRANSFERIDA para esta tela — nunca copiada (cópia = romaneio em dobro):
 * - com a tela dona aberta e mexendo, é recusado (`em_uso`);
 * - o evento é anotado antes de tirar a lista: quando a tela dona voltar, ela
 *   desconta só o que foi levado e mantém o que bipou depois;
 * - se esta tela já tem lista na mesma filial, os itens são somados a ela (antes
 *   a lista desta tela era sobrescrita e sumia).
 * Se gravar no destino falhar, o original volta para o dono.
 */
export async function assumirRascunho(
  id: string,
  username: string,
  tela: string | null
): Promise<AssumirRascunhoResultado> {
  const atual = await buscarRascunho(id);
  if (!atual) return { ok: false, motivo: "inexistente" };

  const destinoId = rascunhoId(
    atual.companyKey,
    username,
    atual.tipoOperacao,
    atual.filial,
    atual.romaneioEdicao,
    tela
  );
  if (destinoId === atual.id) {
    return { ok: true, rascunho: atual, deUsuario: null, jaEraDaTela: true, somado: false, itensAssumidos: [] };
  }
  if (rascunhoEmUso(atual)) {
    return { ok: false, motivo: "em_uso", usuario: atual.username, vistoEm: atual.vistoEm };
  }

  // Lista antiga (sem lista_id) ganha um agora só para o evento valer.
  const listaOrigem = atual.listaId;
  const listaEvento = listaOrigem ?? `legado:${randomUUID()}`;
  if (!(await anotarEvento(listaEvento, atual.id, "assumido", username))) {
    return { ok: false, motivo: "inexistente" };
  }

  const retirado = await retirarRascunho(atual.id, listaOrigem);
  if (!retirado) {
    await desfazerEvento(listaEvento);
    return { ok: false, motivo: "inexistente" };
  }
  await completarEvento(listaEvento, retirado.itens, retirado.observacao);

  try {
    const destinoAtual = await buscarRascunho(destinoId);
    const itens = destinoAtual ? somarItens(destinoAtual.itens, retirado.itens) : retirado.itens;
    const observacao = destinoAtual?.observacao
      ? [destinoAtual.observacao, retirado.observacao].filter(Boolean).join(" | ")
      : retirado.observacao;
    const salvo = await salvarRascunho({
      companyKey: retirado.companyKey,
      username,
      tipoOperacao: retirado.tipoOperacao,
      filial: retirado.filial,
      filialLabel: retirado.filialLabel,
      filialDestino: destinoAtual?.filialDestino ?? retirado.filialDestino,
      filialDestinoLabel: destinoAtual?.filialDestinoLabel ?? retirado.filialDestinoLabel,
      tipoRomaneio: destinoAtual?.tipoRomaneio || retirado.tipoRomaneio,
      observacao,
      romaneioEdicao: retirado.romaneioEdicao,
      tela,
      listaId: destinoAtual?.listaId ?? randomUUID(),
      itens,
    });
    if (salvo.status !== "ok") throw new Error(`Rascunho assumido não gravou (${salvo.status})`);
    const deOutraPessoa = retirado.username.toLowerCase() !== norm(username).toLowerCase();
    return {
      ok: true,
      rascunho: salvo.rascunho,
      deUsuario: deOutraPessoa ? retirado.username : null,
      jaEraDaTela: false,
      somado: !!destinoAtual,
      itensAssumidos: retirado.itens,
    };
  } catch (erro) {
    await devolverRascunho(retirado).catch(() => undefined);
    await desfazerEvento(listaEvento).catch(() => undefined);
    throw erro;
  }
}

export type DescartarRascunhoResultado =
  | { ok: true }
  | { ok: false; motivo: "em_uso"; usuario: string; vistoEm: string | null };

/**
 * Descartar pela aba Rascunhos. A lista da própria tela sai direto; a de outra
 * tela só sai parada (nunca da mão de quem está bipando) e deixa evento: se a
 * tela dona voltar, a lista dela continua lá e é gravada de novo.
 */
export async function descartarRascunho(
  id: string,
  username: string,
  tela: string | null
): Promise<DescartarRascunhoResultado> {
  const atual = await buscarRascunho(id);
  if (!atual) return { ok: true };

  const daPropriaTela =
    !!tela && atual.tela === tela && atual.username.toLowerCase() === norm(username).toLowerCase();
  if (daPropriaTela) {
    await removerRascunho(id);
    return { ok: true };
  }
  if (rascunhoEmUso(atual)) {
    return { ok: false, motivo: "em_uso", usuario: atual.username, vistoEm: atual.vistoEm };
  }

  const listaEvento = atual.listaId ?? `legado:${randomUUID()}`;
  if (!(await anotarEvento(listaEvento, atual.id, "descartado", norm(username) || "?"))) {
    return { ok: true };
  }
  const retirado = await retirarRascunho(atual.id, atual.listaId);
  if (!retirado) {
    await desfazerEvento(listaEvento);
    return { ok: true };
  }
  await completarEvento(listaEvento, retirado.itens, retirado.observacao);
  return { ok: true };
}
