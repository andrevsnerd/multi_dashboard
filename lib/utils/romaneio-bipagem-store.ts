import "server-only";

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * CONFERÊNCIA DE ROMANEIO POR BIPAGEM — cada leitura do gerente vira um EVENTO.
 *
 * O gerente sai bipando peça por peça e só confirma no fim. Guardar a lista
 * inteira a cada bipe (como o rascunho de Saídas/Entradas) faria dois aparelhos
 * no mesmo romaneio apagarem o trabalho um do outro. Aqui cada bipe é uma linha
 * imutável com id gerado no navegador:
 *
 *  - reenviar o mesmo bipe (rede caiu no meio) não conta duas vezes — o id é a PK;
 *  - dois aparelhos bipando o mesmo romaneio somam, não se sobrescrevem;
 *  - fica registrado quem bipou o quê e quando (no "bipei e a peça não foi" de
 *    Saídas não havia log e o caso não deu para reconstruir).
 *
 * A sessão é por romaneio × destino, não por usuário: quem retomar, retoma o que
 * foi bipado. Confirmar (ou descartar) ENCERRA a sessão — os eventos ficam como
 * auditoria e um novo modo bipagem começa do zero.
 *
 * Bipe recusado (excedente, fora do romaneio, código desconhecido) também é
 * gravado, com delta 0: é o rastro que a logística usa para achar a peça sobrando.
 */

const DATA_FILE = path.join(process.cwd(), "data", "romaneio-bipagem-eventos.json");

export type TipoEventoBipagem = "bipe" | "excedente" | "fora_romaneio" | "nao_encontrado";

const TIPOS: TipoEventoBipagem[] = ["bipe", "excedente", "fora_romaneio", "nao_encontrado"];

export interface EventoBipagem {
  /** Gerado no navegador — é o que torna o reenvio idempotente. */
  id: string;
  tipo: TipoEventoBipagem;
  produto: string;
  cor: string;
  /** Posição da grade (P/M/G); null = produto de tamanho único ou sem tamanho no código. */
  tamanho: number | null;
  /** +1 bipou, −1 retirou; 0 nos bipes recusados. */
  delta: number;
  codigo: string;
  username: string;
  criadoEm: string;
}

interface EventoArquivo extends EventoBipagem {
  sessao: string;
  encerradoEm: string | null;
  encerradoMotivo: string | null;
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

/** Chave da sessão: empresa × romaneio × filial de destino (perna ativa). */
export function sessaoBipagemId(companyKey: string, romaneioId: string, filialDestino: string): string {
  return [norm(companyKey).toLowerCase(), norm(romaneioId), norm(filialDestino).toUpperCase()].join("::");
}

export function sanitizeEvento(raw: unknown): Omit<EventoBipagem, "username"> | null {
  const e = (raw ?? {}) as Partial<EventoBipagem>;
  const id = norm(e.id);
  const tipo = TIPOS.includes(e.tipo as TipoEventoBipagem) ? (e.tipo as TipoEventoBipagem) : null;
  if (!id || id.length > 80 || !tipo) return null;
  const delta = Math.trunc(Number(e.delta) || 0);
  if (tipo === "bipe" && delta !== 1 && delta !== -1) return null;
  const tamanho = Number(e.tamanho);
  const criado = new Date(norm(e.criadoEm));
  return {
    id,
    tipo,
    produto: norm(e.produto).slice(0, 60),
    cor: norm(e.cor).slice(0, 20),
    tamanho: Number.isInteger(tamanho) && tamanho >= 1 && tamanho <= 48 ? tamanho : null,
    delta: tipo === "bipe" ? delta : 0,
    codigo: norm(e.codigo).slice(0, 100),
    criadoEm: Number.isNaN(criado.getTime()) ? new Date().toISOString() : criado.toISOString(),
  };
}

// ─────────────────────── fallback em arquivo ───────────────────────

function readFile(): EventoArquivo[] {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFile(rows: EventoArquivo[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

// ─────────────────────────── DDL ───────────────────────────

let ensurePromise: Promise<void> | null = null;

/** DDL concorrente: 23505/42P07/42710 = outra instância criou junto (ver ensure-table-ddl-corrida). */
async function ddl(exec: () => Promise<unknown>): Promise<void> {
  try {
    await exec();
  } catch (erro) {
    const code = (erro as { code?: string } | null)?.code;
    if (code !== "23505" && code !== "42P07" && code !== "42710") throw erro;
  }
}

async function runMigrations(): Promise<void> {
  const sql = getNeonSql();
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS romaneio_bipagem_eventos (
      id TEXT PRIMARY KEY,
      sessao TEXT NOT NULL,
      tipo TEXT NOT NULL,
      produto TEXT NOT NULL DEFAULT '',
      cor TEXT NOT NULL DEFAULT '',
      tamanho INTEGER NOT NULL DEFAULT 0,
      delta INTEGER NOT NULL DEFAULT 0,
      codigo TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL,
      gravado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      encerrado_em TIMESTAMPTZ,
      encerrado_motivo TEXT
    )
  `);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS romaneio_bipagem_eventos_sessao_idx
      ON romaneio_bipagem_eventos (sessao, encerrado_em)
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

/** Eventos da sessão em aberto (ainda não confirmada nem descartada), em ordem. */
export async function listarEventosAbertos(sessao: string): Promise<EventoBipagem[]> {
  if (!hasPostgres()) {
    return readFile()
      .filter((e) => e.sessao === sessao && !e.encerradoEm)
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
      .map(({ sessao: _s, encerradoEm: _e, encerradoMotivo: _m, ...e }) => e);
  }
  await ensureTable();
  const sql = getNeonSql();
  const rows = (await sql`
    SELECT id, tipo, produto, cor, tamanho, delta, codigo, username, criado_em
      FROM romaneio_bipagem_eventos
     WHERE sessao = ${sessao} AND encerrado_em IS NULL
     ORDER BY criado_em, gravado_em
  `) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: norm(r.id),
    tipo: norm(r.tipo) as TipoEventoBipagem,
    produto: norm(r.produto),
    cor: norm(r.cor),
    tamanho: Number(r.tamanho) > 0 ? Number(r.tamanho) : null,
    delta: Number(r.delta) || 0,
    codigo: norm(r.codigo),
    username: norm(r.username),
    criadoEm: r.criado_em instanceof Date ? r.criado_em.toISOString() : norm(r.criado_em),
  }));
}

/** Grava os eventos; id repetido é ignorado (reenvio depois de falha de rede). */
export async function gravarEventos(
  sessao: string,
  username: string,
  eventos: Array<Omit<EventoBipagem, "username">>
): Promise<void> {
  if (eventos.length === 0) return;
  const by = norm(username);

  if (!hasPostgres()) {
    const rows = readFile();
    const ids = new Set(rows.map((r) => r.id));
    for (const e of eventos) {
      if (ids.has(e.id)) continue;
      rows.push({ ...e, username: by, sessao, encerradoEm: null, encerradoMotivo: null });
      ids.add(e.id);
    }
    writeFile(rows);
    return;
  }

  await ensureTable();
  const sql = getNeonSql();
  await sql`
    INSERT INTO romaneio_bipagem_eventos
      (id, sessao, tipo, produto, cor, tamanho, delta, codigo, username, criado_em)
    SELECT u.id, ${sessao}, u.tipo, u.produto, u.cor, u.tamanho, u.delta, u.codigo, ${by}, u.criado_em
      FROM UNNEST(
        ${eventos.map((e) => e.id)}::text[],
        ${eventos.map((e) => e.tipo)}::text[],
        ${eventos.map((e) => e.produto)}::text[],
        ${eventos.map((e) => e.cor)}::text[],
        ${eventos.map((e) => e.tamanho ?? 0)}::int[],
        ${eventos.map((e) => e.delta)}::int[],
        ${eventos.map((e) => e.codigo)}::text[],
        ${eventos.map((e) => e.criadoEm)}::timestamptz[]
      ) AS u(id, tipo, produto, cor, tamanho, delta, codigo, criado_em)
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Fecha a sessão (confirmada ou descartada). Os eventos ficam como auditoria. */
export async function encerrarSessao(sessao: string, motivo: "confirmada" | "descartada", username: string) {
  const marca = `${motivo}:${norm(username)}`;
  if (!hasPostgres()) {
    const agora = new Date().toISOString();
    writeFile(
      readFile().map((e) =>
        e.sessao === sessao && !e.encerradoEm ? { ...e, encerradoEm: agora, encerradoMotivo: marca } : e
      )
    );
    return;
  }
  await ensureTable();
  const sql = getNeonSql();
  await sql`
    UPDATE romaneio_bipagem_eventos
       SET encerrado_em = NOW(), encerrado_motivo = ${marca}
     WHERE sessao = ${sessao} AND encerrado_em IS NULL
  `;
}
