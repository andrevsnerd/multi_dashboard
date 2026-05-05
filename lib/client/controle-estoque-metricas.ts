"use client";

import {
  buildControleEstoqueItemKey,
  dedupeControleEstoqueItens,
  normalizeControleEstoqueItemValue,
  type ControleEstoqueItemInput,
  type ControleEstoqueItemMetricas,
  type ControleEstoqueMetricasItensPayload,
} from "@/lib/utils/controle-estoque-metricas";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  data: ControleEstoqueItemMetricas | null;
};

type PendingResolver = {
  resolve: (value: ControleEstoqueItemMetricas | null) => void;
  reject: (error: unknown) => void;
};

type PendingBatch = {
  payload: Omit<ControleEstoqueMetricasItensPayload, "itens">;
  items: Map<string, ControleEstoqueItemInput>;
  waiters: Map<string, PendingResolver[]>;
  scheduled: boolean;
};

const clientCache = new Map<string, CacheEntry>();
const pendingBatches = new Map<string, PendingBatch>();

function buildScopeKey(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
}): string {
  const company = normalizeControleEstoqueItemValue(input.company).toLowerCase();
  const filial = normalizeControleEstoqueItemValue(input.filial);
  return `${company}::${filial}::${input.includeHistorico ? "hist" : "base"}`;
}

function buildItemCacheKey(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  produto: string;
  corProduto?: string | null;
}): string {
  return `${buildScopeKey(input)}::${buildControleEstoqueItemKey(input.produto, input.corProduto)}`;
}

function getCachedMetricas(cacheKey: string): ControleEstoqueItemMetricas | null | undefined {
  const entry = clientCache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    clientCache.delete(cacheKey);
    return undefined;
  }
  return entry.data;
}

function setCachedMetricas(cacheKey: string, data: ControleEstoqueItemMetricas | null) {
  clientCache.set(cacheKey, {
    expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
    data,
  });
}

function getCachedMetricasWithHistoricoFallback(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  produto: string;
  corProduto?: string | null;
}): ControleEstoqueItemMetricas | null | undefined {
  const direct = getCachedMetricas(buildItemCacheKey(input));
  if (direct !== undefined) return direct;

  if (input.includeHistorico) return undefined;

  return getCachedMetricas(
    buildItemCacheKey({
      ...input,
      includeHistorico: true,
    })
  );
}

async function postMetricasItens(
  payload: ControleEstoqueMetricasItensPayload
): Promise<Record<string, ControleEstoqueItemMetricas>> {
  const response = await fetch("/api/controle-estoque/metricas-itens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    data?: Record<string, ControleEstoqueItemMetricas>;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(json.error ?? "Erro ao carregar metricas dos itens");
  }

  return json.data ?? {};
}

async function flushPendingBatch(scopeKey: string) {
  const pending = pendingBatches.get(scopeKey);
  if (!pending) return;

  pendingBatches.delete(scopeKey);
  const itens = Array.from(pending.items.values());

  try {
    const data = await postMetricasItens({
      ...pending.payload,
      itens,
    });

    for (const item of itens) {
      const itemKey = buildControleEstoqueItemKey(item.produto, item.corProduto);
      const cacheKey = `${scopeKey}::${itemKey}`;
      const value = data[itemKey] ?? null;
      setCachedMetricas(cacheKey, value);
      const waiters = pending.waiters.get(itemKey) ?? [];
      for (const waiter of waiters) waiter.resolve(value);
    }
  } catch (error) {
    for (const waiters of pending.waiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }
}

function queuePendingItem(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  item: ControleEstoqueItemInput;
}): Promise<ControleEstoqueItemMetricas | null> {
  const scopeKey = buildScopeKey(input);
  const itemKey = buildControleEstoqueItemKey(input.item.produto, input.item.corProduto);
  const cacheKey = `${scopeKey}::${itemKey}`;
  const cached = getCachedMetricasWithHistoricoFallback({
    company: input.company,
    filial: input.filial ?? null,
    includeHistorico: input.includeHistorico,
    produto: input.item.produto,
    corProduto: input.item.corProduto,
  });

  if (cached !== undefined) {
    setCachedMetricas(cacheKey, cached);
    return Promise.resolve(cached);
  }

  let pending = pendingBatches.get(scopeKey);
  if (!pending) {
    pending = {
      payload: {
        company: input.company,
        filial: input.filial ?? null,
        includeHistorico: input.includeHistorico,
      },
      items: new Map<string, ControleEstoqueItemInput>(),
      waiters: new Map<string, PendingResolver[]>(),
      scheduled: false,
    };
    pendingBatches.set(scopeKey, pending);
  }

  pending.items.set(itemKey, {
    produto: normalizeControleEstoqueItemValue(input.item.produto),
    corProduto: normalizeControleEstoqueItemValue(input.item.corProduto) || null,
  });

  return new Promise<ControleEstoqueItemMetricas | null>((resolve, reject) => {
    const waiters = pending!.waiters.get(itemKey) ?? [];
    waiters.push({ resolve, reject });
    pending!.waiters.set(itemKey, waiters);

    if (!pending!.scheduled) {
      pending!.scheduled = true;
      queueMicrotask(() => {
        void flushPendingBatch(scopeKey);
      });
    }
  });
}

export async function fetchControleEstoqueItemMetricasClient(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  item: ControleEstoqueItemInput;
}): Promise<ControleEstoqueItemMetricas | null> {
  const produto = normalizeControleEstoqueItemValue(input.item.produto);
  if (!produto) return null;
  return queuePendingItem({
    company: input.company,
    filial: input.filial ?? null,
    includeHistorico: input.includeHistorico,
    item: {
      produto,
      corProduto: normalizeControleEstoqueItemValue(input.item.corProduto) || null,
    },
  });
}

export async function fetchControleEstoqueMetricasItensClient(
  payload: ControleEstoqueMetricasItensPayload
): Promise<Record<string, ControleEstoqueItemMetricas>> {
  const itens = dedupeControleEstoqueItens(payload.itens ?? []);
  const rows = await Promise.all(
    itens.map(async (item) => {
      const data = await fetchControleEstoqueItemMetricasClient({
        company: payload.company,
        filial: payload.filial ?? null,
        includeHistorico: payload.includeHistorico,
        item,
      });
      return [buildControleEstoqueItemKey(item.produto, item.corProduto), data] as const;
    })
  );

  const result: Record<string, ControleEstoqueItemMetricas> = {};
  for (const [key, value] of rows) {
    if (value) result[key] = value;
  }
  return result;
}
