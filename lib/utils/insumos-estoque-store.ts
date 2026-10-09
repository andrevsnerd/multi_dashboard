import "server-only";

/**
 * Estoque de EMBALAGENS e AVIAMENTOS por rede — o que a tela "Embalagens e Aviamentos" edita.
 *
 * Duas redes, os mesmos itens:
 *
 * - **Rede ScarfMe** é o estoque que a Projeção Compra sempre usou. Lê e grava pelos stores
 *   de lá ([embalagens-estoque-store.ts](@/lib/utils/embalagens-estoque-store) e
 *   [aviamentos-estoque-store.ts](@/lib/utils/aviamentos-estoque-store)), linha `scarfme`.
 *   Por isso o que se altera aqui já aparece nas abas Embalagens e Aviamentos da projeção.
 * - **Corporativo** fica nas MESMAS tabelas (`embalagens_estoque` / `aviamentos_estoque`),
 *   na linha `corporativo`. Começa zerado: a semente da planilha é da rede ScarfMe e não
 *   vale aqui. Só um subconjunto dos itens existe no Corporativo (`ITENS_CORPORATIVO`).
 *   A projeção não lê esta linha.
 *
 * Sem cache de processo — ver [[cache-processo-store-valor-velho]].
 */

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import { EMBALAGEM_IDS } from "@/lib/config/embalagens";
import { AVIAMENTO_IDS } from "@/lib/config/aviamentos";
import {
  carregarEstoqueEmbalagens,
  salvarEstoqueEmbalagens,
} from "@/lib/utils/embalagens-estoque-store";
import {
  carregarEstoqueAviamentos,
  salvarEstoqueAviamentos,
} from "@/lib/utils/aviamentos-estoque-store";

export type RedeInsumo = "scarfme" | "corporativo";
export type TipoInsumo = "embalagens" | "aviamentos";

export const REDES_INSUMO: RedeInsumo[] = ["scarfme", "corporativo"];
export const TIPOS_INSUMO: TipoInsumo[] = ["embalagens", "aviamentos"];

/** id do item → unidades em estoque. */
export type EstoqueInsumos = Record<string, number>;

/** Linha das tabelas de estoque que guarda o Corporativo. */
const CHAVE_CORPORATIVO = "corporativo";

const ARQUIVOS: Record<TipoInsumo, string> = {
  embalagens: path.join(process.cwd(), "data", "embalagens-estoque.json"),
  aviamentos: path.join(process.cwd(), "data", "aviamentos-estoque.json"),
};

/**
 * Os itens que o Corporativo usa (definição do dono, 09/10/2026). Os outros são só da rede
 * ScarfMe: não aparecem na tela e o store não grava estoque para eles.
 */
export const ITENS_CORPORATIVO: Record<TipoInsumo, string[]> = {
  embalagens: ["caixa-lenco-scarfme", "caixa-twilly", "caixa-pashmina-scarfme"],
  aviamentos: [
    "X5.01.0002", // etiqueta de marca
    "X5.03.0004", // etiqueta de composição
    "X5.13.0014", // etiqueta BOP transparente
    "X5.07.0008", // faixa ScarfMe
    "X5.06.0007", // lâmina ScarfMe
    "X5.09.0010", // lacre
  ],
};

const TODOS_IDS: Record<TipoInsumo, string[]> = {
  embalagens: EMBALAGEM_IDS,
  aviamentos: AVIAMENTO_IDS,
};

/** Só os do Corporativo que ainda existem no cadastro de itens. */
const IDS: Record<TipoInsumo, string[]> = {
  embalagens: ITENS_CORPORATIVO.embalagens.filter((id) => TODOS_IDS.embalagens.includes(id)),
  aviamentos: ITENS_CORPORATIVO.aviamentos.filter((id) => TODOS_IDS.aviamentos.includes(id)),
};

type ArquivoEstoque = Record<string, unknown>;

function lerArquivo(tipo: TipoInsumo): ArquivoEstoque {
  try {
    if (!fs.existsSync(ARQUIVOS[tipo])) return {};
    return JSON.parse(fs.readFileSync(ARQUIVOS[tipo], "utf-8")) as ArquivoEstoque;
  } catch {
    return {};
  }
}

function escreverArquivo(tipo: TipoInsumo, dados: ArquivoEstoque) {
  const dir = path.dirname(ARQUIVOS[tipo]);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVOS[tipo], JSON.stringify(dados, null, 2), "utf-8");
}

/** Mesma tolerância dos stores de origem — ver [[ensure-table-ddl-corrida]]. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

const ensurePromises: Partial<Record<TipoInsumo, Promise<void>>> = {};

/** Mesmo DDL dos stores de origem: a tabela é a mesma, só muda a linha. */
async function ensureTable(tipo: TipoInsumo): Promise<void> {
  if (!ensurePromises[tipo]) {
    ensurePromises[tipo] = (async () => {
      const sql = getNeonSql();
      try {
        if (tipo === "embalagens") {
          await sql`
            CREATE TABLE IF NOT EXISTS embalagens_estoque (
              company TEXT PRIMARY KEY,
              estoque JSONB NOT NULL,
              atualizado_por TEXT,
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
          `;
        } else {
          await sql`
            CREATE TABLE IF NOT EXISTS aviamentos_estoque (
              company TEXT PRIMARY KEY,
              estoque JSONB NOT NULL,
              atualizado_por TEXT,
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
          `;
        }
      } catch (erro) {
        if (!objetoJaExiste(erro)) throw erro;
      }
    })().catch((erro) => {
      delete ensurePromises[tipo];
      throw erro;
    });
  }
  return ensurePromises[tipo];
}

/** Só ids conhecidos, só inteiro ≥ 0. Item nunca editado no Corporativo vale 0. */
function normalizarCorporativo(tipo: TipoInsumo, bruto: unknown): EstoqueInsumos {
  const base: EstoqueInsumos = Object.fromEntries(IDS[tipo].map((id) => [id, 0]));
  if (!bruto || typeof bruto !== "object") return base;
  const entrada = bruto as Record<string, unknown>;
  IDS[tipo].forEach((id) => {
    if (!(id in entrada)) return;
    const n = Number(entrada[id]);
    if (!Number.isFinite(n)) return;
    base[id] = Math.max(0, Math.round(n));
  });
  return base;
}

async function carregarCorporativo(tipo: TipoInsumo): Promise<EstoqueInsumos> {
  let bruto: unknown = null;
  if (!hasPostgres()) {
    bruto = lerArquivo(tipo)[CHAVE_CORPORATIVO] ?? null;
  } else {
    const sql = getNeonSql();
    await ensureTable(tipo);
    const rows =
      tipo === "embalagens"
        ? await sql`SELECT estoque FROM embalagens_estoque WHERE company = ${CHAVE_CORPORATIVO}`
        : await sql`SELECT estoque FROM aviamentos_estoque WHERE company = ${CHAVE_CORPORATIVO}`;
    bruto = rows[0]?.estoque ?? null;
  }
  return normalizarCorporativo(tipo, bruto);
}

async function salvarCorporativo(
  tipo: TipoInsumo,
  bruto: unknown,
  usuario: string
): Promise<EstoqueInsumos> {
  // O que chega da tela pode ser parcial (só a linha editada), então mescla com o salvo.
  const atual = await carregarCorporativo(tipo);
  const estoque = normalizarCorporativo(tipo, {
    ...atual,
    ...(bruto as Record<string, unknown> | null),
  });

  if (!hasPostgres()) {
    const dados = lerArquivo(tipo);
    dados[CHAVE_CORPORATIVO] = estoque;
    escreverArquivo(tipo, dados);
  } else {
    const sql = getNeonSql();
    await ensureTable(tipo);
    const json = JSON.stringify(estoque);
    if (tipo === "embalagens") {
      await sql`
        INSERT INTO embalagens_estoque (company, estoque, atualizado_por, updated_at)
        VALUES (${CHAVE_CORPORATIVO}, ${json}::jsonb, ${usuario}, NOW())
        ON CONFLICT (company) DO UPDATE
          SET estoque = EXCLUDED.estoque,
              atualizado_por = EXCLUDED.atualizado_por,
              updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO aviamentos_estoque (company, estoque, atualizado_por, updated_at)
        VALUES (${CHAVE_CORPORATIVO}, ${json}::jsonb, ${usuario}, NOW())
        ON CONFLICT (company) DO UPDATE
          SET estoque = EXCLUDED.estoque,
              atualizado_por = EXCLUDED.atualizado_por,
              updated_at = NOW()
      `;
    }
  }

  return { ...estoque };
}

export async function carregarEstoqueInsumos(
  tipo: TipoInsumo,
  rede: RedeInsumo
): Promise<EstoqueInsumos> {
  if (rede === "corporativo") return carregarCorporativo(tipo);
  return tipo === "embalagens"
    ? carregarEstoqueEmbalagens("scarfme")
    : carregarEstoqueAviamentos("scarfme");
}

export async function salvarEstoqueInsumos(
  tipo: TipoInsumo,
  rede: RedeInsumo,
  bruto: unknown,
  usuario: string
): Promise<EstoqueInsumos> {
  if (rede === "corporativo") return salvarCorporativo(tipo, bruto, usuario);
  return tipo === "embalagens"
    ? salvarEstoqueEmbalagens("scarfme", bruto, usuario)
    : salvarEstoqueAviamentos("scarfme", bruto, usuario);
}
