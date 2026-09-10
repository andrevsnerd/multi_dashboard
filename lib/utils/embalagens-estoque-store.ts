import "server-only";

/**
 * Estoque atual de cada EMBALAGEM, por empresa.
 *
 * Embalagem não é produto cadastrado no Linx — não tem `ESTOQUE_PRODUTOS`, não tem romaneio,
 * não tem movimento. O número vem da contagem física de quem embala. Então aqui ele é dado
 * digitado: a semente é a contagem da planilha (`estoqueInicial` em
 * [embalagens.ts](@/lib/config/embalagens)) e, a partir do primeiro salvamento, vale o que
 * estiver gravado.
 *
 * Arquivo JSON local em dev, tabela Postgres em produção — mesmo padrão de
 * `etiquetas-config-store.ts`.
 */

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import { EMBALAGEM_IDS, estoqueInicialMap } from "@/lib/config/embalagens";

const ARQUIVO = path.join(process.cwd(), "data", "embalagens-estoque.json");

/** id da embalagem → unidades em estoque. */
export type EstoqueEmbalagens = Record<string, number>;

let tabelaChecada = false;
let ensurePromise: Promise<void> | null = null;
const cache = new Map<string, EstoqueEmbalagens>();

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
          CREATE TABLE IF NOT EXISTS embalagens_estoque (
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

/** Só ids conhecidos, só inteiro ≥ 0. Embalagem sem valor salvo cai no estoque de fábrica. */
function normalizar(bruto: unknown): EstoqueEmbalagens {
  const base = estoqueInicialMap();
  if (!bruto || typeof bruto !== "object") return base;
  const entrada = bruto as Record<string, unknown>;
  EMBALAGEM_IDS.forEach((id) => {
    if (!(id in entrada)) return;
    const n = Number(entrada[id]);
    if (!Number.isFinite(n)) return;
    base[id] = Math.max(0, Math.round(n));
  });
  return base;
}

/** Estoque salvo da empresa, completado com a contagem de fábrica de quem nunca foi editado. */
export async function carregarEstoqueEmbalagens(company: string): Promise<EstoqueEmbalagens> {
  const emCache = cache.get(company);
  if (emCache) return { ...emCache };

  let bruto: unknown = null;
  if (!hasPostgres()) {
    bruto = lerArquivo()[company] ?? null;
  } else {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`SELECT estoque FROM embalagens_estoque WHERE company = ${company}`;
    bruto = rows[0]?.estoque ?? null;
  }

  const estoque = normalizar(bruto);
  cache.set(company, estoque);
  return { ...estoque };
}

export async function salvarEstoqueEmbalagens(
  company: string,
  bruto: unknown,
  usuario: string
): Promise<EstoqueEmbalagens> {
  // O que chega da tela pode ser parcial (só a linha editada), então mescla com o salvo.
  const atual = await carregarEstoqueEmbalagens(company);
  const estoque = normalizar({ ...atual, ...(bruto as Record<string, unknown> | null) });

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados[company] = estoque;
    escreverArquivo(dados);
  } else {
    const sql = getNeonSql();
    await ensureTable();
    await sql`
      INSERT INTO embalagens_estoque (company, estoque, atualizado_por, updated_at)
      VALUES (${company}, ${JSON.stringify(estoque)}::jsonb, ${usuario}, NOW())
      ON CONFLICT (company) DO UPDATE
        SET estoque = EXCLUDED.estoque,
            atualizado_por = EXCLUDED.atualizado_por,
            updated_at = NOW()
    `;
  }

  cache.set(company, estoque);
  return { ...estoque };
}
