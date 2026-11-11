import "server-only";

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * Metas de painéis que não são as metas mensais por filial do dashboard (essas ficam no
 * goals-storage). Uma linha por (empresa, escopo, chave):
 *  - escopo "black-friday", chave = ano da campanha ("2026") → meta GERAL da Black, em R$,
 *    sobre a venda dos itens da Black (pedido do dono, 11/11/2026);
 *  - escopo "shopify", chave = mês "YYYY-MM" → meta do mês da loja Shopify, em R$.
 * Valor 0 apaga a meta.
 */

export type MetaEscopo = "black-friday" | "shopify";

export interface MetaPainel {
  company: string;
  escopo: MetaEscopo;
  chave: string;
  valor: number;
  usuario: string;
  updatedAt: string;
}

const ARQUIVO = path.join(process.cwd(), "data", "metas-paineis.json");

/* ── fallback em arquivo (sem Postgres) ── */

function lerArquivo(): MetaPainel[] {
  try {
    if (!fs.existsSync(ARQUIVO)) return [];
    const parsed = JSON.parse(fs.readFileSync(ARQUIVO, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function gravarArquivo(rows: MetaPainel[]) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(rows, null, 2), "utf-8");
}

const mesmaChave = (a: Pick<MetaPainel, "company" | "escopo" | "chave">, b: typeof a) =>
  a.company === b.company && a.escopo === b.escopo && a.chave === b.chave;

/* ── Neon ── */

let tabelaOk = false;
let ensurePromise: Promise<void> | null = null;

/** DDL concorrente: "já existe" (23505 em pg_type / 42P07 / 42710) é sucesso. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ensureTable(): Promise<void> {
  if (tabelaOk) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getNeonSql();
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS metas_paineis (
            company TEXT NOT NULL,
            escopo TEXT NOT NULL,
            chave TEXT NOT NULL,
            valor NUMERIC(14, 2) NOT NULL,
            usuario TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (company, escopo, chave)
          )
        `;
      } catch (erro) {
        if (!objetoJaExiste(erro)) throw erro;
      }
    })()
      .then(() => {
        tabelaOk = true;
      })
      .catch((erro) => {
        ensurePromise = null;
        throw erro;
      });
  }
  return ensurePromise;
}

function mapRow(row: Record<string, unknown>): MetaPainel {
  return {
    company: String(row.company),
    escopo: String(row.escopo) as MetaEscopo,
    chave: String(row.chave),
    valor: Number(row.valor) || 0,
    usuario: String(row.usuario ?? ""),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
  };
}

export async function getMetaPainel(company: string, escopo: MetaEscopo, chave: string): Promise<MetaPainel | null> {
  if (!hasPostgres()) {
    return lerArquivo().find((r) => mesmaChave(r, { company, escopo, chave })) ?? null;
  }
  await ensureTable();
  const sql = getNeonSql();
  const rows = await sql`
    SELECT company, escopo, chave, valor, usuario, updated_at
    FROM metas_paineis
    WHERE company = ${company} AND escopo = ${escopo} AND chave = ${chave}
  `;
  return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
}

/** Grava a meta (valor > 0) ou apaga (valor 0). Devolve null quando apagou. */
export async function saveMetaPainel(input: {
  company: string;
  escopo: MetaEscopo;
  chave: string;
  valor: number;
  usuario: string;
}): Promise<MetaPainel | null> {
  const valor = Math.round((Number(input.valor) || 0) * 100) / 100;
  if (valor < 0 || valor > 1_000_000_000) throw new Error("Meta inválida.");
  const { company, escopo, chave, usuario } = input;

  if (!hasPostgres()) {
    const outras = lerArquivo().filter((r) => !mesmaChave(r, { company, escopo, chave }));
    if (valor === 0) {
      gravarArquivo(outras);
      return null;
    }
    const registro: MetaPainel = { company, escopo, chave, valor, usuario, updatedAt: new Date().toISOString() };
    gravarArquivo([...outras, registro]);
    return registro;
  }

  await ensureTable();
  const sql = getNeonSql();
  if (valor === 0) {
    await sql`DELETE FROM metas_paineis WHERE company = ${company} AND escopo = ${escopo} AND chave = ${chave}`;
    return null;
  }
  const rows = await sql`
    INSERT INTO metas_paineis (company, escopo, chave, valor, usuario, updated_at)
    VALUES (${company}, ${escopo}, ${chave}, ${valor}, ${usuario}, NOW())
    ON CONFLICT (company, escopo, chave) DO UPDATE SET
      valor = EXCLUDED.valor,
      usuario = EXCLUDED.usuario,
      updated_at = NOW()
    RETURNING company, escopo, chave, valor, usuario, updated_at
  `;
  return mapRow(rows[0] as Record<string, unknown>);
}
