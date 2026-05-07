"use client";

import type { CompraTransito } from "@/lib/types/compra-transito";
import { buildControleEstoqueItemKey } from "@/lib/utils/controle-estoque-metricas";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";

const CACHE_TTL_MS = 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  data: CompraTransito[];
};

const comprasCache = new Map<string, CacheEntry>();
const pendingByCompany = new Map<string, Promise<CompraTransito[]>>();

export interface CompraTransitoIndexEntry {
  itemKey: string;
  produto: string;
  corProduto: string | null;
  quantidade: number;
  dataRecebimento: string;
  title: string;
  confirmedAt: string;
}

export type CompraTransitoIndex = Map<string, CompraTransitoIndexEntry[]>;

function normalizeDate(value?: string | null): string {
  return (value ?? "").trim().slice(0, 10);
}

function getCached(companyKey: string): CompraTransito[] | undefined {
  const entry = comprasCache.get(companyKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    comprasCache.delete(companyKey);
    return undefined;
  }
  return entry.data;
}

function setCached(companyKey: string, data: CompraTransito[]) {
  comprasCache.set(companyKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  });
}

export async function fetchComprasTransitoClient(companyKey: string): Promise<CompraTransito[]> {
  const cached = getCached(companyKey);
  if (cached) return cached;

  const pending = pendingByCompany.get(companyKey);
  if (pending) return pending;

  const params = new URLSearchParams({
    company: companyKey,
    includeItems: "1",
  });

  const promise = fetch(`/api/compras-transito?${params.toString()}`, { cache: "no-store" })
    .then(async (response) => {
      const json = (await response.json()) as { data?: CompraTransito[]; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Erro ao carregar compras em trânsito");
      }
      const data = json.data ?? [];
      setCached(companyKey, data);
      return data;
    })
    .finally(() => {
      pendingByCompany.delete(companyKey);
    });

  pendingByCompany.set(companyKey, promise);
  return promise;
}

export function buildCompraTransitoIndex(compras: CompraTransito[]): CompraTransitoIndex {
  const index = new Map<string, CompraTransitoIndexEntry[]>();

  compras.forEach((compra) => {
    (compra.items ?? []).forEach((item) => {
      const produto = String(item.produto ?? "").trim();
      if (!produto) return;
      if (!isCompraTransitoDateActive(item.dataRecebimento)) return;
      const corProduto = String(item.corProduto ?? "").trim() || null;
      const itemKey = buildControleEstoqueItemKey(produto, corProduto);
      const entry: CompraTransitoIndexEntry = {
        itemKey,
        produto,
        corProduto,
        quantidade: Math.max(0, Math.round(Number(item.quantidade ?? 0))),
        dataRecebimento: normalizeDate(item.dataRecebimento),
        title: compra.title,
        confirmedAt: compra.confirmedAt,
      };
      if (!index.has(itemKey)) index.set(itemKey, []);
      index.get(itemKey)!.push(entry);
    });
  });

  index.forEach((entries, key) => {
    index.set(
      key,
      [...entries].sort((a, b) => a.dataRecebimento.localeCompare(b.dataRecebimento))
    );
  });

  return index;
}

export function getCompraTransitoEntries(
  index: CompraTransitoIndex,
  produto?: string | null,
  corProduto?: string | null
): CompraTransitoIndexEntry[] {
  const key = buildControleEstoqueItemKey(produto, corProduto);
  return index.get(key) ?? [];
}
