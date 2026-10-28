import "server-only";

/**
 * Estoque OFFLINE de aproveitamentos da matriz — o que a tela "Aproveitamentos Matriz" edita.
 *
 * Contagem 100% manual de peças que existem na matriz mas ainda não entraram no Linx. Não é,
 * nem alimenta, o estoque oficial (ESTOQUE_PRODUTOS): nada aqui escreve no Linx.
 *
 * Um documento por empresa na tabela `aproveitamentos_matriz` (só scarfme hoje): a lista
 * inteira de itens, com vínculo ao produto e estoque. Enquanto nunca foi salvo, vale a
 * semente de [aproveitamentos-matriz.ts](@/lib/config/aproveitamentos-matriz).
 *
 * Sem cache de processo — ver [[cache-processo-store-valor-velho]].
 */

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  APROVEITAMENTOS_SEMENTE,
  FORMATOS_APROVEITAMENTO,
  type AproveitamentoItem,
  type FormatoAproveitamento,
} from "@/lib/config/aproveitamentos-matriz";

export interface AproveitamentosSalvos {
  itens: AproveitamentoItem[];
  /** null = nunca salvo (é a semente). */
  atualizadoPor: string | null;
  atualizadoEm: string | null;
}

// Caminho LITERAL — ver o comentário em insumos-estoque-store.ts sobre o rastreio do build.
const ARQUIVO = path.join(process.cwd(), "data", "aproveitamentos-matriz.json");

const MAX_ITENS = 500;
const FORMATOS = FORMATOS_APROVEITAMENTO.map((f) => f.key);

function lerArquivo(): Record<string, unknown> {
  try {
    if (!fs.existsSync(ARQUIVO)) return {};
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function escreverArquivo(dados: Record<string, unknown>) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), "utf-8");
}

/** Ver [[ensure-table-ddl-corrida]]. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

let ensurePromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getNeonSql();
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS aproveitamentos_matriz (
            company TEXT PRIMARY KEY,
            itens JSONB NOT NULL,
            atualizado_por TEXT,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `;
      } catch (erro) {
        if (!objetoJaExiste(erro)) throw erro;
      }
    })().catch((erro) => {
      ensurePromise = null;
      throw erro;
    });
  }
  return ensurePromise;
}

function texto(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Valida a lista que chega da tela (ou do banco). Descarta linha sem nome ou com formato
 * desconhecido; estoque é inteiro ≥ 0; id repetido fica só com a primeira ocorrência.
 */
export function normalizarItens(bruto: unknown): AproveitamentoItem[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const itens: AproveitamentoItem[] = [];
  for (const linha of bruto.slice(0, MAX_ITENS)) {
    if (!linha || typeof linha !== "object") continue;
    const l = linha as Record<string, unknown>;
    const id = texto(l.id, 80);
    const nome = texto(l.nome, 120);
    const formato = texto(l.formato, 10) as FormatoAproveitamento;
    if (!id || !nome || !FORMATOS.includes(formato) || vistos.has(id)) continue;
    vistos.add(id);
    const produto = texto(l.produto, 20).toUpperCase();
    const cor = texto(l.cor, 10).toUpperCase();
    const nota = texto(l.nota, 400);
    const n = Number(l.estoque);
    itens.push({
      id,
      formato,
      nome,
      produto: produto || null,
      cor: cor || null,
      estoque: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0,
      nota: nota || null,
    });
  }
  return itens;
}

interface LinhaSalva {
  itens: unknown;
  atualizado_por: string | null;
  updated_at: string | Date | null;
}

export async function carregarAproveitamentos(company: string): Promise<AproveitamentosSalvos> {
  let linha: LinhaSalva | null = null;
  if (!hasPostgres()) {
    const salvo = lerArquivo()[company] as
      | { itens?: unknown; atualizadoPor?: string; atualizadoEm?: string }
      | undefined;
    if (salvo) {
      linha = {
        itens: salvo.itens,
        atualizado_por: salvo.atualizadoPor ?? null,
        updated_at: salvo.atualizadoEm ?? null,
      };
    }
  } else {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`
      SELECT itens, atualizado_por, updated_at FROM aproveitamentos_matriz WHERE company = ${company}
    `;
    linha = (rows[0] as LinhaSalva | undefined) ?? null;
  }

  if (!linha) {
    return {
      itens: APROVEITAMENTOS_SEMENTE.map((i) => ({ ...i })),
      atualizadoPor: null,
      atualizadoEm: null,
    };
  }
  return {
    itens: normalizarItens(linha.itens),
    atualizadoPor: linha.atualizado_por ?? null,
    atualizadoEm:
      linha.updated_at instanceof Date ? linha.updated_at.toISOString() : linha.updated_at ?? null,
  };
}

/** Grava a lista INTEIRA (é o que a tela manda no "Salvar"). */
export async function salvarAproveitamentos(
  company: string,
  bruto: unknown,
  usuario: string
): Promise<AproveitamentosSalvos> {
  const itens = normalizarItens(bruto);

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados[company] = { itens, atualizadoPor: usuario, atualizadoEm: new Date().toISOString() };
    escreverArquivo(dados);
  } else {
    const sql = getNeonSql();
    await ensureTable();
    await sql`
      INSERT INTO aproveitamentos_matriz (company, itens, atualizado_por, updated_at)
      VALUES (${company}, ${JSON.stringify(itens)}::jsonb, ${usuario}, NOW())
      ON CONFLICT (company) DO UPDATE
        SET itens = EXCLUDED.itens,
            atualizado_por = EXCLUDED.atualizado_por,
            updated_at = NOW()
    `;
  }

  return carregarAproveitamentos(company);
}
