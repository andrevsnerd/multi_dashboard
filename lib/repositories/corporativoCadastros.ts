import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import type {
  ClienteCorporativoInput,
  RegistroPendente,
  RegistroStatus,
  TipoPessoa,
} from "@/lib/corporativo/types";

/**
 * Persistência dos AUTOCADASTROS corporativos pendentes de aprovação.
 *
 * O usuário do sistema (dashboard_users) é criado no ato do autocadastro, mas o
 * cliente no Linx só nasce quando um aprovador (admin/diretor/supervisor) aprova.
 * Este store guarda a "fila" de aprovação e o payload completo (já padronizado)
 * para revisão/edição antes de efetivar no Linx.
 *
 * Segue o padrão do app: Neon quando DATABASE_URL existe; senão arquivo JSON.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const REGISTROS_FILE = path.join(DATA_DIR, "corporativo-cadastros.json");

let tableChecked = false;

async function ensureTable() {
  if (tableChecked) return;
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS corporativo_cadastros_pendentes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      tipo_pessoa TEXT NOT NULL DEFAULT 'PJ',
      razao_social TEXT NOT NULL DEFAULT '',
      cpf_cnpj TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
      cliente_codigo TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revisado_por TEXT,
      revisado_em TIMESTAMPTZ,
      motivo_rejeicao TEXT
    )
  `;
  tableChecked = true;
}

async function readFile(): Promise<RegistroPendente[]> {
  try {
    const raw = await fs.readFile(REGISTROS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegistroPendente[]) : [];
  } catch {
    return [];
  }
}
async function writeFile(rows: RegistroPendente[]): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  await fs.writeFile(REGISTROS_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

function rowToRegistro(row: {
  id: string;
  user_id: string;
  username: string;
  tipo_pessoa: string;
  razao_social: string;
  cpf_cnpj: string;
  status: string;
  payload: ClienteCorporativoInput | string;
  avisos: string[] | string;
  cliente_codigo: string | null;
  criado_em: Date | string;
  revisado_por: string | null;
  revisado_em: Date | string | null;
  motivo_rejeicao: string | null;
}): RegistroPendente {
  const payload =
    typeof row.payload === "string" ? (JSON.parse(row.payload) as ClienteCorporativoInput) : row.payload;
  const avisos = typeof row.avisos === "string" ? (JSON.parse(row.avisos) as string[]) : row.avisos ?? [];
  return {
    id: row.id,
    userId: row.user_id ?? "",
    username: row.username ?? "",
    tipoPessoa: (row.tipo_pessoa as TipoPessoa) ?? "PJ",
    razaoSocial: row.razao_social ?? "",
    cpfCnpj: row.cpf_cnpj ?? "",
    status: (row.status as RegistroStatus) ?? "pendente",
    payload,
    avisos: Array.isArray(avisos) ? avisos : [],
    clienteCodigo: row.cliente_codigo?.trim() || null,
    criadoEm: new Date(row.criado_em).toISOString(),
    revisadoPor: row.revisado_por ?? null,
    revisadoEm: row.revisado_em ? new Date(row.revisado_em).toISOString() : null,
    motivoRejeicao: row.motivo_rejeicao ?? null,
  };
}

export interface CriarRegistroInput {
  userId: string;
  username: string;
  tipoPessoa: TipoPessoa;
  razaoSocial: string;
  cpfCnpj: string;
  payload: ClienteCorporativoInput;
  avisos: string[];
}

export async function criarRegistroPendente(input: CriarRegistroInput): Promise<RegistroPendente> {
  const id = randomUUID();
  const nowIso = () => new Date().toISOString();
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      INSERT INTO corporativo_cadastros_pendentes
        (id, user_id, username, tipo_pessoa, razao_social, cpf_cnpj, status, payload, avisos)
      VALUES (
        ${id}, ${input.userId}, ${input.username}, ${input.tipoPessoa},
        ${input.razaoSocial}, ${input.cpfCnpj}, 'pendente',
        ${JSON.stringify(input.payload)}::jsonb, ${JSON.stringify(input.avisos ?? [])}::jsonb
      )
      RETURNING *`;
    return rowToRegistro(rows[0] as Parameters<typeof rowToRegistro>[0]);
  }
  const registro: RegistroPendente = {
    id,
    userId: input.userId,
    username: input.username,
    tipoPessoa: input.tipoPessoa,
    razaoSocial: input.razaoSocial,
    cpfCnpj: input.cpfCnpj,
    status: "pendente",
    payload: input.payload,
    avisos: input.avisos ?? [],
    clienteCodigo: null,
    criadoEm: nowIso(),
    revisadoPor: null,
    revisadoEm: null,
    motivoRejeicao: null,
  };
  const all = await readFile();
  all.push(registro);
  await writeFile(all);
  return registro;
}

export async function listRegistros(opts: { status?: RegistroStatus; limit?: number } = {}): Promise<RegistroPendente[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = opts.status
      ? await sql`SELECT * FROM corporativo_cadastros_pendentes WHERE status = ${opts.status} ORDER BY criado_em DESC LIMIT ${limit}`
      : await sql`SELECT * FROM corporativo_cadastros_pendentes ORDER BY criado_em DESC LIMIT ${limit}`;
    return rows.map((r) => rowToRegistro(r as Parameters<typeof rowToRegistro>[0]));
  }
  let all = (await readFile()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  if (opts.status) all = all.filter((r) => r.status === opts.status);
  return all.slice(0, limit);
}

export async function getRegistro(id: string): Promise<RegistroPendente | null> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`SELECT * FROM corporativo_cadastros_pendentes WHERE id = ${id} LIMIT 1`;
    const row = rows[0] as Parameters<typeof rowToRegistro>[0] | undefined;
    return row ? rowToRegistro(row) : null;
  }
  const all = await readFile();
  return all.find((r) => r.id === id) ?? null;
}

/** Existe autocadastro NÃO-rejeitado (pendente/aprovado) com este documento? */
export async function existePorDocumento(cpfCnpj: string): Promise<RegistroPendente | null> {
  const digits = String(cpfCnpj ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT * FROM corporativo_cadastros_pendentes
      WHERE cpf_cnpj = ${digits} AND status <> 'rejeitado'
      ORDER BY criado_em DESC LIMIT 1`;
    const row = rows[0] as Parameters<typeof rowToRegistro>[0] | undefined;
    return row ? rowToRegistro(row) : null;
  }
  const all = await readFile();
  return all.find((r) => r.cpfCnpj === digits && r.status !== "rejeitado") ?? null;
}

/** Marca aprovado, guardando o código do Linx, o revisor e o payload final (editado). */
export async function aprovarRegistro(
  id: string,
  data: { clienteCodigo: string; revisadoPor: string; payload: ClienteCorporativoInput }
): Promise<void> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      UPDATE corporativo_cadastros_pendentes
      SET status = 'aprovado', cliente_codigo = ${data.clienteCodigo},
          revisado_por = ${data.revisadoPor}, revisado_em = NOW(),
          payload = ${JSON.stringify(data.payload)}::jsonb
      WHERE id = ${id}`;
    return;
  }
  const all = await readFile();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      status: "aprovado",
      clienteCodigo: data.clienteCodigo,
      revisadoPor: data.revisadoPor,
      revisadoEm: new Date().toISOString(),
      payload: data.payload,
    };
    await writeFile(all);
  }
}

export async function rejeitarRegistro(
  id: string,
  data: { revisadoPor: string; motivo: string }
): Promise<void> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      UPDATE corporativo_cadastros_pendentes
      SET status = 'rejeitado', revisado_por = ${data.revisadoPor}, revisado_em = NOW(),
          motivo_rejeicao = ${data.motivo}
      WHERE id = ${id}`;
    return;
  }
  const all = await readFile();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      status: "rejeitado",
      revisadoPor: data.revisadoPor,
      revisadoEm: new Date().toISOString(),
      motivoRejeicao: data.motivo,
    };
    await writeFile(all);
  }
}

/** Contagem de pendentes (para badge de aprovação). */
export async function countPendentes(): Promise<number> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`SELECT COUNT(*)::int AS n FROM corporativo_cadastros_pendentes WHERE status = 'pendente'`;
    return Number((rows[0] as { n: number })?.n ?? 0);
  }
  const all = await readFile();
  return all.filter((r) => r.status === "pendente").length;
}
