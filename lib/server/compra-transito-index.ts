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
