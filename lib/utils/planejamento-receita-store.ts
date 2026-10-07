/**
 * Orçado editado na tela do Planejamento de Receita.
 *
 * A planilha do financeiro continua sendo a BASE (`lib/config/planejamento-receita.ts`);
 * aqui fica só o que foi alterado na tela, célula a célula (empresa × ano × canal × mês),
 * por cima da base. Apagar a edição devolve o valor da planilha. Ano que não existe na
 * planilha (ex.: 2028 criado na tela) tem base zero e vive inteiro aqui.
 *
 * Neon quando há DATABASE_URL, JSON em data/ quando não há — mesmo esquema do
 * compra-gastos-store. Sem cache de processo: orçado é dado digitado, e cache em memória
 * faria a edição "voltar sozinha" em outra instância.
 *
 * Toda alteração grava uma linha de histórico (valor anterior → novo, quem, quando).
 */

import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import {
  type CanalPlanejamento,
  type OrcadoAno,
  getPlanejamentoEmpresa,
} from "@/lib/config/planejamento-receita";

export const CANAIS_ORCADO: CanalPlanejamento[] = ["lojas", "web", "corporativo"];

export interface OrcadoEdicao {
  canal: CanalPlanejamento;
  /** 1..12 */
  mes: number;
  valor: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface OrcadoAlteracao {
  canal: CanalPlanejamento;
  mes: number;
  /** null = remove a edição e volta ao valor da planilha. */
  valor: number | null;
}

interface LinhaArquivo extends OrcadoEdicao {
  companyKey: string;
  ano: number;
}

interface HistoricoArquivo {
  companyKey: string;
  ano: number;
  canal: CanalPlanejamento;
  mes: number;
  valorAnterior: number;
  valorNovo: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface FileShape {
  edicoes: LinhaArquivo[];
  historico: HistoricoArquivo[];
}

const FILE_PATH = path.join(process.cwd(), "data", "planejamento-receita.json");

// ───────────────────────── schema ─────────────────────────

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;

/** Corrida de DDL concorrente: o objeto passou a existir, é sucesso (ver compra-gastos-store). */
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
    CREATE TABLE IF NOT EXISTS planejamento_receita_orcado (
      company_key TEXT NOT NULL,
      ano INTEGER NOT NULL,
      canal TEXT NOT NULL,
      mes INTEGER NOT NULL,
      valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_key, ano, canal, mes)
    )
  `);
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS planejamento_receita_orcado_hist (
      id BIGSERIAL PRIMARY KEY,
      company_key TEXT NOT NULL,
      ano INTEGER NOT NULL,
      canal TEXT NOT NULL,
      mes INTEGER NOT NULL,
      valor_anterior NUMERIC(14, 2) NOT NULL,
      valor_novo NUMERIC(14, 2),
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await ddl(() => sql`
    CREATE INDEX IF NOT EXISTS planejamento_receita_orcado_hist_idx
      ON planejamento_receita_orcado_hist (company_key, ano)
  `);
}

async function readFileAll(): Promise<FileShape> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE_PATH, "utf-8")) as FileShape;
    return {
      edicoes: Array.isArray(parsed?.edicoes) ? parsed.edicoes : [],
      historico: Array.isArray(parsed?.historico) ? parsed.historico : [],
    };
  } catch {
    return { edicoes: [], historico: [] };
  }
}

async function writeFileAll(data: FileShape) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

function isCanal(v: unknown): v is CanalPlanejamento {
  return CANAIS_ORCADO.includes(v as CanalPlanejamento);
}

// ───────────────────────── leitura ─────────────────────────

export async function listEdicoes(companyKey: string, ano: number): Promise<OrcadoEdicao[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT canal, mes, valor, updated_by, updated_at
      FROM planejamento_receita_orcado
      WHERE company_key = ${companyKey} AND ano = ${ano}
    `;
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => isCanal(r.canal))
      .map((r) => ({
        canal: r.canal as CanalPlanejamento,
        mes: Number(r.mes),
        valor: num(r.valor),
        updatedBy: (r.updated_by as string) ?? null,
        updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
      }));
  }
  const all = await readFileAll();
  return all.edicoes
    .filter((e) => e.companyKey === companyKey && e.ano === ano)
    .map(({ canal, mes, valor, updatedBy, updatedAt }) => ({ canal, mes, valor, updatedBy, updatedAt }));
}

/** Anos que só existem por edição na tela (ex.: o ano seguinte criado antes da planilha). */
async function anosEditados(companyKey: string): Promise<number[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT DISTINCT ano FROM planejamento_receita_orcado WHERE company_key = ${companyKey}
    `;
    return rows.map((r) => Number((r as Record<string, unknown>).ano));
  }
  const all = await readFileAll();
  return Array.from(new Set(all.edicoes.filter((e) => e.companyKey === companyKey).map((e) => e.ano)));
}

export async function listAnosOrcado(companyKey: string): Promise<number[]> {
  const plano = getPlanejamentoEmpresa(companyKey);
  const base = plano ? Object.keys(plano.anos).map(Number) : [];
  const editados = await anosEditados(companyKey);
  return Array.from(new Set([...base, ...editados])).sort((a, b) => a - b);
}

function orcadoBase(companyKey: string, ano: number): OrcadoAno | null {
  return getPlanejamentoEmpresa(companyKey)?.anos[ano] ?? null;
}

export interface OrcadoResolvido {
  orcado: OrcadoAno;
  /** O que veio da planilha (null se o ano não existe nela). */
  planilha: OrcadoAno | null;
  edicoes: OrcadoEdicao[];
}

/** Orçado efetivo do ano: planilha com as edições da tela por cima. null se não existe nenhum dos dois. */
export async function resolverOrcado(companyKey: string, ano: number): Promise<OrcadoResolvido | null> {
  const planilha = orcadoBase(companyKey, ano);
  const edicoes = await listEdicoes(companyKey, ano);
  if (!planilha && edicoes.length === 0) return null;

  const zeros = () => Array.from({ length: 12 }, () => 0);
  const orcado: OrcadoAno = {
    lojas: [...(planilha?.lojas ?? zeros())],
    web: [...(planilha?.web ?? zeros())],
    corporativo: [...(planilha?.corporativo ?? zeros())],
    regras: { ...(planilha?.regras ?? {}) },
  };
  for (const e of edicoes) {
    if (e.mes >= 1 && e.mes <= 12) orcado[e.canal][e.mes - 1] = e.valor;
  }
  return { orcado, planilha, edicoes };
}

// ───────────────────────── escrita ─────────────────────────

/**
 * Aplica um lote de alterações do mesmo ano. Valor igual ao da planilha também remove a
 * edição (não guarda "edição" que não muda nada). Devolve quantas células mudaram.
 */
export async function salvarOrcado(
  companyKey: string,
  ano: number,
  alteracoes: OrcadoAlteracao[],
  updatedBy: string
): Promise<number> {
  const atual = await resolverOrcado(companyKey, ano);
  const planilha = orcadoBase(companyKey, ano);
  const now = new Date().toISOString();

  const efetivas = alteracoes
    .filter((a) => isCanal(a.canal) && Number.isInteger(a.mes) && a.mes >= 1 && a.mes <= 12)
    .map((a) => {
      const anterior = atual ? atual.orcado[a.canal][a.mes - 1] ?? 0 : 0;
      const base = planilha ? planilha[a.canal][a.mes - 1] ?? 0 : 0;
      const valor = a.valor == null ? null : num(Math.max(0, a.valor));
      // Sem planilha não há "voltar": restaurar vira zero.
      // A tela arredonda ao real: até R$ 0,50 da planilha é "o valor da planilha".
      const remover = valor == null ? planilha != null : planilha != null && Math.abs(valor - base) < 0.5;
      const valorFinal = remover ? base : (valor ?? 0);
      const temEdicao = !!atual?.edicoes.some((e) => e.canal === a.canal && e.mes === a.mes);
      return { ...a, anterior, valorFinal, remover, temEdicao };
    })
    // Remover só conta se havia edição; senão é "salvar o mesmo valor", que não muda nada.
    .filter((a) => a.valorFinal !== a.anterior || (a.remover && a.temEdicao));

  if (efetivas.length === 0) return 0;

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    for (const a of efetivas) {
      if (a.remover) {
        await sql`
          DELETE FROM planejamento_receita_orcado
          WHERE company_key = ${companyKey} AND ano = ${ano} AND canal = ${a.canal} AND mes = ${a.mes}
        `;
      } else {
        await sql`
          INSERT INTO planejamento_receita_orcado (company_key, ano, canal, mes, valor, updated_by, updated_at)
          VALUES (${companyKey}, ${ano}, ${a.canal}, ${a.mes}, ${a.valorFinal}, ${updatedBy}, ${now})
          ON CONFLICT (company_key, ano, canal, mes) DO UPDATE
            SET valor = EXCLUDED.valor, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
        `;
      }
      await sql`
        INSERT INTO planejamento_receita_orcado_hist
          (company_key, ano, canal, mes, valor_anterior, valor_novo, updated_by, updated_at)
        VALUES (${companyKey}, ${ano}, ${a.canal}, ${a.mes}, ${a.anterior}, ${a.remover ? null : a.valorFinal}, ${updatedBy}, ${now})
      `;
    }
    return efetivas.length;
  }

  const all = await readFileAll();
  for (const a of efetivas) {
    const i = all.edicoes.findIndex(
      (e) => e.companyKey === companyKey && e.ano === ano && e.canal === a.canal && e.mes === a.mes
    );
    if (a.remover) {
      if (i >= 0) all.edicoes.splice(i, 1);
    } else {
      const linha: LinhaArquivo = {
        companyKey,
        ano,
        canal: a.canal,
        mes: a.mes,
        valor: a.valorFinal,
        updatedBy,
        updatedAt: now,
      };
      if (i >= 0) all.edicoes[i] = linha;
      else all.edicoes.push(linha);
    }
    all.historico.push({
      companyKey,
      ano,
      canal: a.canal,
      mes: a.mes,
      valorAnterior: a.anterior,
      valorNovo: a.remover ? null : a.valorFinal,
      updatedBy,
      updatedAt: now,
    });
  }
  await writeFileAll(all);
  return efetivas.length;
}
