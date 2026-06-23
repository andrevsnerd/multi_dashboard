"use client";

import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import type { CompraDataFixaEntry } from "@/lib/utils/compra-data-fixa-store";

export type { CompraDataFixaEntry } from "@/lib/utils/compra-data-fixa-store";

export interface CompraDataFixaUpsertInput {
  itemKey: string;
  dataCompra: string;
  transitoSig: string;
}

/**
 * Assinatura de trânsito de um item = maior `confirmedAt` entre as compras em trânsito.
 * Quando um pedido novo é confirmado, esse valor avança → sinal de que a catraca da data
 * deve ser re-baseada (novo ciclo). Sem trânsito ⇒ "".
 */
export function computeTransitoSig(entries: CompraTransitoIndexEntry[]): string {
  let max = "";
  for (const e of entries) {
    const c = (e.confirmedAt ?? "").trim();
    if (c && c > max) max = c;
  }
  return max;
}

/** Carrega as datas de compra de um contexto (empresa+filial). */
export async function fetchComprasDataFixa(
  companyKey: string,
  filial: string
): Promise<Record<string, CompraDataFixaEntry>> {
  const params = new URLSearchParams({ company: companyKey, filial: filial ?? "" });
  const res = await fetch(`/api/controle-estoque/compra-data-fixa?${params.toString()}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: Record<string, CompraDataFixaEntry>; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar datas de compra");
  return json.data ?? {};
}

/** Grava/atualiza um lote de datas (avanço da catraca ou re-base por trânsito novo). */
export async function saveComprasDataFixa(
  companyKey: string,
  filial: string,
  entries: CompraDataFixaUpsertInput[]
): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await fetch(`/api/controle-estoque/compra-data-fixa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyKey, filial: filial ?? "", entries }),
  });
  const json = (await res.json()) as { count?: number; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao salvar datas de compra");
  return json.count ?? 0;
}
