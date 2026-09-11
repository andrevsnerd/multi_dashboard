/**
 * Índice de compras em TRÂNSITO ativas por (produto × cor) — a peça que já foi comprada e
 * ainda não chegou.
 *
 * Estava privado dentro de [reportCompraSugeridaAbc.ts](@/lib/repositories/reportCompraSugeridaAbc),
 * e a Projeção Compra precisa exatamente do mesmo índice para responder "quanto já está
 * comprado". Duas implementações do mesmo casamento produto×cor divergiriam na primeira vez
 * que alguém ajustasse o fallback por descrição — então ele mora aqui e as duas importam.
 */

import { canonicalKey } from "@/lib/reports/keys";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";
import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";

export type { CompraTransitoIndexEntry };
export type CompraTransitoServerIndex = Map<string, CompraTransitoIndexEntry[]>;

/**
 * Alias por DESCRIÇÃO de cor (espelha lib/client/compras-transito): casa quando o código de
 * cor gravado no trânsito difere do código de estoque/curva mas representa a MESMA cor
 * (ex.: '86' x '120' = AZUL/VERDE), quando o trânsito veio sem código, ou quando gravaram a
 * descrição no lugar do código. Prefixo dedicado para nunca colidir com a chave canônica.
 */
const TRANSIT_DESC_PREFIX = " desc ";

export function transitDescKey(
  produto: string | null | undefined,
  corProduto: string | null | undefined,
  corDescricao?: string | null
): string | null {
  // A descrição de cor é escopada POR PRODUTO no Linx (o mesmo código descreve cores
  // diferentes em produtos diferentes). Prioriza a descrição do cadastro do item;
  // getMappedColorDescription (mapa global) entra só como fallback quando vazia.
  const doProduto = (corDescricao ?? "").trim();
  const base = doProduto || getMappedColorDescription(corProduto);
  const raw = base.trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!raw) return null;
  return `${TRANSIT_DESC_PREFIX}${String(produto ?? "").trim()}||${raw}`;
}

/** Compras em trânsito ativas, indexadas pela chave canônica e pelo alias de descrição. */
export async function buildCompraTransitoServerIndex(
  company: string | undefined
): Promise<CompraTransitoServerIndex> {
  const idx: CompraTransitoServerIndex = new Map();
  if (!company) return idx;
  const compras = await listComprasTransitoFull(company).catch(() => []);
  const today = new Date();
  for (const c of compras) {
    for (const it of c.items ?? []) {
      if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
      const entry: CompraTransitoIndexEntry = {
        itemKey: it.itemKey ?? "",
        produto: it.produto,
        corProduto: it.corProduto ?? null,
        quantidade: Number(it.quantidade ?? 0),
        dataRecebimento: it.dataRecebimento,
        title: c.title ?? "",
        confirmedAt: c.confirmedAt ?? "",
      };
      const k = canonicalKey(it.produto, it.corProduto ?? null);
      idx.set(k, [...(idx.get(k) ?? []), entry]);
      const dk = transitDescKey(it.produto, it.corProduto, it.corDescricao);
      if (dk) idx.set(dk, [...(idx.get(dk) ?? []), entry]);
    }
  }
  return idx;
}

/** Uma linha do trânsito ativo, somada por produto × cor. */
export interface TransitoItemAgregado {
  produto: string;
  /** Código da cor como o trânsito gravou (pode não existir no estoque). */
  cor: string;
  /** Descrição da cor gravada na compra — é por ela que o filtro de Cor da tela casa. */
  corDescricao: string;
  quantidade: number;
  /** Data de chegada mais próxima entre as linhas somadas. */
  proximaChegada: string;
}

/**
 * TODO o trânsito ativo da empresa, somado por produto × cor.
 *
 * Serve para ENUMERAR ("o que está vindo?"), enquanto o índice acima serve para CONSULTAR
 * ("está vindo algo deste item?"). São funções diferentes e a diferença importa: o índice
 * grava cada compra em DUAS chaves (a canônica e o alias por descrição de cor), então
 * varrê-lo inteiro contaria a mesma peça duas vezes. Aqui a leitura é da própria lista de
 * compras, uma vez por linha.
 */
export async function listTransitoAtivoPorItem(
  company: string | undefined,
  opcoes?: {
    /**
     * Compras SALVAS cujo trânsito deve ficar de fora.
     *
     * Existe para a Projeção Compra não contar a mesma peça duas vezes quando uma compra
     * salva é importada: a lista já mostra "Na compra salva 30", e se aquela mesma compra
     * virou trânsito ("Exportar para trânsito"), as 30 apareceriam de novo em "Já vem em
     * trânsito" e a sugestão desceria pelo dobro. Trânsito de OUTRA compra continua
     * contando — é peça diferente, a caminho de verdade.
     */
    excluirCompraSalvaIds?: string[] | null;
  }
): Promise<Map<string, TransitoItemAgregado>> {
  const out = new Map<string, TransitoItemAgregado>();
  if (!company) return out;
  const compras = await listComprasTransitoFull(company).catch(() => []);
  const excluir = new Set(
    (opcoes?.excluirCompraSalvaIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)
  );
  const today = new Date();
  for (const c of compras) {
    if (excluir.size > 0 && c.compraSalvaId && excluir.has(String(c.compraSalvaId).trim())) continue;
    for (const it of c.items ?? []) {
      if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
      const produto = String(it.produto ?? "").trim();
      if (!produto) continue;
      const quantidade = Number(it.quantidade ?? 0) || 0;
      if (quantidade <= 0) continue;
      const cor = String(it.corProduto ?? "").trim();
      const key = `${produto}||${cor}`;
      const atual = out.get(key);
      if (atual) {
        atual.quantidade += quantidade;
        if (!atual.corDescricao && it.corDescricao) atual.corDescricao = String(it.corDescricao).trim();
        if (it.dataRecebimento && it.dataRecebimento < atual.proximaChegada) {
          atual.proximaChegada = it.dataRecebimento;
        }
      } else {
        out.set(key, {
          produto,
          cor,
          corDescricao: String(it.corDescricao ?? "").trim(),
          quantidade,
          proximaChegada: it.dataRecebimento,
        });
      }
    }
  }
  return out;
}

/**
 * Entradas de trânsito de UM item, com o fallback por descrição de cor.
 *
 * O alias por descrição só é consultado quando a chave canônica não achou nada — senão a
 * mesma compra entraria duas vezes (ela é indexada nas duas chaves).
 */
export function transitoDoItem(
  index: CompraTransitoServerIndex,
  produto: string,
  corProduto: string | null,
  corDescricao?: string | null
): CompraTransitoIndexEntry[] {
  const direto = index.get(canonicalKey(produto, corProduto));
  if (direto && direto.length > 0) return direto;
  const dk = transitDescKey(produto, corProduto, corDescricao);
  return (dk ? index.get(dk) : undefined) ?? [];
}

/** Quantas peças daquele item já estão compradas e a caminho. */
export function quantidadeEmTransito(
  index: CompraTransitoServerIndex,
  produto: string,
  corProduto: string | null,
  corDescricao?: string | null
): number {
  return transitoDoItem(index, produto, corProduto, corDescricao).reduce(
    (soma, e) => soma + (Number(e.quantidade) || 0),
    0
  );
}
