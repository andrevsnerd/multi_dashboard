import "server-only";

/**
 * Estoque atual de cada AVIAMENTO, por empresa — cópia do store das embalagens
 * ([embalagens-estoque-store.ts](@/lib/utils/embalagens-estoque-store)), com tabela própria.
 *
 * O número é digitado na tela: a semente é o provisório de
 * [aviamentos.ts](@/lib/config/aviamentos) (10 de cada) e, a partir do primeiro
 * salvamento, vale o que estiver gravado.
 *
 * Arquivo JSON local em dev, tabela Postgres em produção.
 */

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import { AVIAMENTO_IDS, estoqueInicialAviamentos } from "@/lib/config/aviamentos";

const ARQUIVO = path.join(process.cwd(), "data", "aviamentos-estoque.json");

/** código do aviamento → unidades em estoque. */
export type EstoqueAviamentos = Record<string, number>;

let tabelaChecada = false;
let ensurePromise: Promise<void> | null = null;

type ArquivoEstoque = Record<string, unknown>;

function lerArquivo(): ArquivoEstoque {
  try {
    if (!fs.existsSync(ARQUIVO)) return {};
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf-8")) as ArquivoEstoque;
  } catch {
    return {};
  }
}

function escreverArquivo(dados: ArquivoEstoque) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), "utf-8");
}

/**
 * `CREATE TABLE IF NOT EXISTS` não é atômico contra criação concorrente: dois pedidos ao
 * mesmo tempo derrubam um deles com 23505 em `pg_type` ou 42P07. Nos dois casos a tabela
 * passou a existir — ver [[ensure-table-ddl-corrida]].
 */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ensureTable(): Promise<void> {
  if (tabelaChecada) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getNeonSql();
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS aviamentos_estoque (
            company TEXT PRIMARY KEY,
            estoque JSONB NOT NULL,
            atualizado_por TEXT,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `;
      } catch (erro) {
        if (!objetoJaExiste(erro)) throw erro;
      }
      tabelaChecada = true;
    })().catch((erro) => {
      ensurePromise = null;
      throw erro;
    });
  }
  return ensurePromise;
}

/** Só ids conhecidos, só inteiro ≥ 0. Aviamento sem valor salvo cai no estoque provisório. */
function normalizar(bruto: unknown): EstoqueAviamentos {
  const base = estoqueInicialAviamentos();
  if (!bruto || typeof bruto !== "object") return base;
  const entrada = bruto as Record<string, unknown>;
  AVIAMENTO_IDS.forEach((id) => {
    if (!(id in entrada)) return;
    const n = Number(entrada[id]);
    if (!Number.isFinite(n)) return;
    base[id] = Math.max(0, Math.round(n));
  });
  return base;
}

/**
 * Estoque salvo da empresa, completado com a contagem de fábrica de quem nunca foi editado.
 *
 * Sem cache de propósito. É uma linha só de leitura, e um cache de processo em serverless
 * devolve o número velho para sempre: quem gravou caiu numa instância e quem lê cai em
 * outra, que ficou com o valor de antes — era o que fazia a célula "voltar sozinha".
 */
export async function carregarEstoqueAviamentos(company: string): Promise<EstoqueAviamentos> {
  let bruto: unknown = null;
  if (!hasPostgres()) {
    bruto = lerArquivo()[company] ?? null;
  } else {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`SELECT estoque FROM aviamentos_estoque WHERE company = ${company}`;
    bruto = rows[0]?.estoque ?? null;
  }

  return normalizar(bruto);
}

export async function salvarEstoqueAviamentos(
  company: string,
  bruto: unknown,
  usuario: string
): Promise<EstoqueAviamentos> {
  // O que chega da tela pode ser parcial (só a linha editada), então mescla com o salvo.
  const atual = await carregarEstoqueAviamentos(company);
  const estoque = normalizar({ ...atual, ...(bruto as Record<string, unknown> | null) });

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados[company] = estoque;
    escreverArquivo(dados);
  } else {
    const sql = getNeonSql();
    await ensureTable();
    await sql`
      INSERT INTO aviamentos_estoque (company, estoque, atualizado_por, updated_at)
      VALUES (${company}, ${JSON.stringify(estoque)}::jsonb, ${usuario}, NOW())
      ON CONFLICT (company) DO UPDATE
        SET estoque = EXCLUDED.estoque,
            atualizado_por = EXCLUDED.atualizado_por,
            updated_at = NOW()
    `;
  }

  return { ...estoque };
}
