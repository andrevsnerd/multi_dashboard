import "server-only";

/**
 * Tarefas de alteração de preço (tela Programar Preços).
 *
 * Uma tarefa é um conjunto de alterações PRONTAS (produto × coluna × valor novo) que
 * fica pendente até alguém aplicar na mão ou até o horário agendado no QStash.
 * A aplicação em si é a mesma do Alterar Custo / Preço (`executarAlteracaoPrecos`):
 * o lote vai para a NERD_PRECO_HISTORICO e o "Reverter" de lá desfaz.
 *
 * Arquivo JSON local em dev, tabela Postgres em produção — mesmo padrão de
 * `compra-ciclo-store.ts`.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import type { ExecutarPrecosResult, PrecoCompany } from "@/lib/repositories/precos";

export type TarefaStatus = "pendente" | "agendada" | "executando" | "aplicada" | "erro";

/**
 * `produto`: preço da tabela vale para todas as cores (PRODUTOS_PRECOS).
 * `cor`: cada item é `PRODUTO|COR` e grava PRODUTOS_PRECO_COR (ver precosCor.ts).
 */
export type TarefaModo = "produto" | "cor";

export interface TarefaProduto {
  produto: string;
  descricao: string;
}

export interface TarefaAlteracao {
  produto: string;
  /** `T::<tabela>::PRECOn` — mesma chave do Alterar Custo / Preço. */
  campoKey: string;
  valor: number;
  /** Valor quando a tarefa foi montada. Só para exibição: a execução relê o banco. */
  atual: number | null;
  tabela: string;
  tabelaDesc: string;
}

export interface PrecoTarefa {
  id: string;
  company: PrecoCompany;
  nome: string;
  modo: TarefaModo;
  status: TarefaStatus;
  agendadoPara: string | null;
  agendadoPor: string | null;
  qstashMessageId: string | null;
  produtos: TarefaProduto[];
  alteracoes: TarefaAlteracao[];
  criadoPor: string;
  criadoEm: string;
  atualizadoPor: string | null;
  atualizadoEm: string;
  executadoPor: string | null;
  executadoEm: string | null;
  lote: string | null;
  resultado: ExecutarPrecosResult | null;
  erro: string | null;
}

const ARQUIVO = path.join(process.cwd(), "data", "preco-tarefas.json");

/** Execução presa (função morta por timeout) libera depois disso. */
export const EXECUCAO_TRAVADA_MS = 10 * 60 * 1000;

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;

/* ────────────────────────────── arquivo (dev) ────────────────────────────── */

function lerArquivo(): PrecoTarefa[] {
  try {
    if (!fs.existsSync(ARQUIVO)) return [];
    const json = JSON.parse(fs.readFileSync(ARQUIVO, "utf-8")) as { tarefas?: PrecoTarefa[] };
    return Array.isArray(json.tarefas) ? json.tarefas : [];
  } catch {
    return [];
  }
}

function escreverArquivo(tarefas: PrecoTarefa[]) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ tarefas }, null, 2), "utf-8");
}

/* ────────────────────────────── tabela (prod) ────────────────────────────── */

/** DDL concorrente: 23505/42P07 significam que o outro pedido já criou. */
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
    CREATE TABLE IF NOT EXISTS preco_tarefas (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      nome TEXT NOT NULL,
      status TEXT NOT NULL,
      agendado_para TIMESTAMPTZ,
      agendado_por TEXT,
      qstash_message_id TEXT,
      produtos JSONB NOT NULL DEFAULT '[]'::jsonb,
      alteracoes JSONB NOT NULL DEFAULT '[]'::jsonb,
      criado_por TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executado_por TEXT,
      executado_em TIMESTAMPTZ,
      lote TEXT,
      resultado JSONB,
      erro TEXT
    )
  `);
  await ddl(() => sql`CREATE INDEX IF NOT EXISTS preco_tarefas_company_idx ON preco_tarefas (company, status)`);
  // `modo` entrou com o preço por cor; tarefas antigas são por produto.
  await ddl(() => sql`ALTER TABLE preco_tarefas ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'produto'`);
}

type Row = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function fromRow(r: Row): PrecoTarefa {
  return {
    id: String(r.id),
    company: r.company === "scarfme" ? "scarfme" : "nerd",
    nome: String(r.nome ?? ""),
    modo: r.modo === "cor" ? "cor" : "produto",
    status: String(r.status ?? "pendente") as TarefaStatus,
    agendadoPara: iso(r.agendado_para),
    agendadoPor: (r.agendado_por as string | null) ?? null,
    qstashMessageId: (r.qstash_message_id as string | null) ?? null,
    produtos: (r.produtos as TarefaProduto[] | null) ?? [],
    alteracoes: (r.alteracoes as TarefaAlteracao[] | null) ?? [],
    criadoPor: String(r.criado_por ?? ""),
    criadoEm: iso(r.criado_em) ?? "",
    atualizadoPor: (r.atualizado_por as string | null) ?? null,
    atualizadoEm: iso(r.atualizado_em) ?? "",
    executadoPor: (r.executado_por as string | null) ?? null,
    executadoEm: iso(r.executado_em),
    lote: (r.lote as string | null) ?? null,
    resultado: (r.resultado as ExecutarPrecosResult | null) ?? null,
    erro: (r.erro as string | null) ?? null,
  };
}

/* ──────────────────────────────── leitura ────────────────────────────────── */

/**
 * Tarefas da empresa, mais novas primeiro. As aplicadas saem por padrão: depois de
 * aplicada, a tarefa vive no histórico de lotes.
 */
export async function listarTarefas(
  company: PrecoCompany,
  opts: { incluirAplicadas?: boolean } = {}
): Promise<PrecoTarefa[]> {
  let tarefas: PrecoTarefa[];
  if (!hasPostgres()) {
    tarefas = lerArquivo().filter((t) => t.company === company);
  } else {
    await ensureTable();
    const sql = getNeonSql();
    const rows = (await sql`
      SELECT * FROM preco_tarefas WHERE company = ${company}
      ORDER BY COALESCE(agendado_para, criado_em) DESC
      LIMIT 300
    `) as Row[];
    tarefas = rows.map(fromRow);
  }
  if (!opts.incluirAplicadas) tarefas = tarefas.filter((t) => t.status !== "aplicada");
  return tarefas.sort((a, b) =>
    (b.agendadoPara ?? b.criadoEm).localeCompare(a.agendadoPara ?? a.criadoEm)
  );
}

export async function obterTarefa(id: string): Promise<PrecoTarefa | null> {
  if (!hasPostgres()) return lerArquivo().find((t) => t.id === id) ?? null;
  await ensureTable();
  const sql = getNeonSql();
  const rows = (await sql`SELECT * FROM preco_tarefas WHERE id = ${id}`) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

/* ──────────────────────────────── escrita ────────────────────────────────── */

export interface SalvarTarefaInput {
  id?: string | null;
  company: PrecoCompany;
  nome: string;
  modo: TarefaModo;
  produtos: TarefaProduto[];
  alteracoes: TarefaAlteracao[];
  usuario: string;
}

/** Cria ou atualiza o conteúdo da tarefa. Agendamento é tratado à parte. */
export async function salvarTarefa(input: SalvarTarefaInput): Promise<PrecoTarefa> {
  const agora = new Date().toISOString();

  if (!hasPostgres()) {
    const todas = lerArquivo();
    const existente = input.id ? todas.find((t) => t.id === input.id) : undefined;
    const tarefa: PrecoTarefa = existente
      ? { ...existente, nome: input.nome, modo: input.modo, produtos: input.produtos, alteracoes: input.alteracoes,
          atualizadoPor: input.usuario, atualizadoEm: agora }
      : {
          id: randomUUID(), company: input.company, nome: input.nome, modo: input.modo, status: "pendente",
          agendadoPara: null, agendadoPor: null, qstashMessageId: null,
          produtos: input.produtos, alteracoes: input.alteracoes,
          criadoPor: input.usuario, criadoEm: agora, atualizadoPor: null, atualizadoEm: agora,
          executadoPor: null, executadoEm: null, lote: null, resultado: null, erro: null,
        };
    escreverArquivo([tarefa, ...todas.filter((t) => t.id !== tarefa.id)]);
    return tarefa;
  }

  await ensureTable();
  const sql = getNeonSql();
  const produtos = JSON.stringify(input.produtos);
  const alteracoes = JSON.stringify(input.alteracoes);

  if (input.id) {
    const rows = (await sql`
      UPDATE preco_tarefas
      SET nome = ${input.nome}, modo = ${input.modo}, produtos = ${produtos}::jsonb, alteracoes = ${alteracoes}::jsonb,
          atualizado_por = ${input.usuario}, atualizado_em = NOW()
      WHERE id = ${input.id} AND company = ${input.company}
      RETURNING *
    `) as Row[];
    if (!rows[0]) throw new Error("Tarefa não encontrada.");
    return fromRow(rows[0]);
  }

  const rows = (await sql`
    INSERT INTO preco_tarefas (id, company, nome, modo, status, produtos, alteracoes, criado_por)
    VALUES (${randomUUID()}, ${input.company}, ${input.nome}, ${input.modo}, 'pendente',
            ${produtos}::jsonb, ${alteracoes}::jsonb, ${input.usuario})
    RETURNING *
  `) as Row[];
  return fromRow(rows[0]);
}

/** Atualiza só os campos informados. */
export async function atualizarTarefa(
  id: string,
  campos: Partial<
    Pick<
      PrecoTarefa,
      | "status" | "agendadoPara" | "agendadoPor" | "qstashMessageId" | "executadoPor"
      | "executadoEm" | "lote" | "resultado" | "erro" | "atualizadoPor"
    >
  >
): Promise<PrecoTarefa | null> {
  if (!hasPostgres()) {
    const todas = lerArquivo();
    const i = todas.findIndex((t) => t.id === id);
    if (i < 0) return null;
    todas[i] = { ...todas[i], ...campos, atualizadoEm: new Date().toISOString() };
    escreverArquivo(todas);
    return todas[i];
  }

  await ensureTable();
  const sql = getNeonSql();
  const atual = await obterTarefa(id);
  if (!atual) return null;
  const m = { ...atual, ...campos };
  const rows = (await sql`
    UPDATE preco_tarefas
    SET status = ${m.status}, agendado_para = ${m.agendadoPara}, agendado_por = ${m.agendadoPor},
        qstash_message_id = ${m.qstashMessageId}, executado_por = ${m.executadoPor},
        executado_em = ${m.executadoEm}, lote = ${m.lote},
        resultado = ${m.resultado ? JSON.stringify(m.resultado) : null}::jsonb,
        erro = ${m.erro}, atualizado_por = ${m.atualizadoPor}, atualizado_em = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * Trava a tarefa para execução: só um pedido ganha (clique duplo, ou o clique manual
 * coincidindo com o disparo agendado). `messageId` amarra o disparo à mensagem
 * CORRENTE do QStash — reagendar troca o id e a mensagem antiga vira no-op.
 */
export async function reivindicarExecucao(
  id: string,
  opts: { messageId?: string | null; usuario: string }
): Promise<PrecoTarefa | null> {
  const travadaAntes = new Date(Date.now() - EXECUCAO_TRAVADA_MS).toISOString();

  if (!hasPostgres()) {
    const todas = lerArquivo();
    const i = todas.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const t = todas[i];
    const livre = opts.messageId
      ? t.status === "agendada" && t.qstashMessageId === opts.messageId
      : ["pendente", "agendada", "erro"].includes(t.status) ||
        (t.status === "executando" && t.atualizadoEm < travadaAntes);
    if (!livre) return null;
    todas[i] = { ...t, status: "executando", executadoPor: opts.usuario, erro: null,
                 atualizadoEm: new Date().toISOString() };
    escreverArquivo(todas);
    return todas[i];
  }

  await ensureTable();
  const sql = getNeonSql();
  const rows = opts.messageId
    ? ((await sql`
        UPDATE preco_tarefas
        SET status = 'executando', executado_por = ${opts.usuario}, erro = NULL, atualizado_em = NOW()
        WHERE id = ${id} AND status = 'agendada' AND qstash_message_id = ${opts.messageId}
        RETURNING *
      `) as Row[])
    : ((await sql`
        UPDATE preco_tarefas
        SET status = 'executando', executado_por = ${opts.usuario}, erro = NULL, atualizado_em = NOW()
        WHERE id = ${id}
          AND (status IN ('pendente', 'agendada', 'erro')
               OR (status = 'executando' AND atualizado_em < ${travadaAntes}))
        RETURNING *
      `) as Row[]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function excluirTarefa(id: string): Promise<void> {
  if (!hasPostgres()) {
    escreverArquivo(lerArquivo().filter((t) => t.id !== id));
    return;
  }
  await ensureTable();
  const sql = getNeonSql();
  await sql`DELETE FROM preco_tarefas WHERE id = ${id}`;
}
