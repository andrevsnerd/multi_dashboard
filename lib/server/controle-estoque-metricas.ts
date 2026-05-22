import {
  fetchEstoqueProdutoPorFilial,
  fetchVendasProdutoPorFilial,
} from "@/lib/repositories/controleEstoque";
import {
  getActiveFilial,
  getFilialGroupMembers,
  resolveCompany,
  VAREJO_VALUE,
} from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import {
  buildControleEstoqueItemKey,
  dedupeControleEstoqueItens,
  normalizeControleEstoqueItemValue,
  summarizeControleEstoqueItemMetricas,
  type ControleEstoqueItemInput,
  type ControleEstoqueItemMetricas,
  type ControleEstoqueMetricasItensPayload,
} from "@/lib/utils/controle-estoque-metricas";

const SERVER_CACHE_TTL_MS = 10 * 60 * 1000;
const SERVER_BATCH_CONCURRENCY = 6;

type CacheEntry = {
  expiresAt: number;
  data: ControleEstoqueItemMetricas;
};

const metricasCache = new Map<string, CacheEntry>();
const metricasInFlight = new Map<string, Promise<ControleEstoqueItemMetricas>>();
const dynamicCompanyCache = new Map<string, Promise<Awaited<ReturnType<typeof resolveCompanyDynamic>>>>();

function buildScopeCacheKey(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  item: ControleEstoqueItemInput;
}): string {
  const company = normalizeControleEstoqueItemValue(input.company).toLowerCase();
  const filial = normalizeControleEstoqueItemValue(input.filial);
  const itemKey = buildControleEstoqueItemKey(input.item.produto, input.item.corProduto);
  return `${company}::${filial}::${input.includeHistorico ? "hist" : "base"}::${itemKey}`;
}

function getCachedMetricas(cacheKey: string): ControleEstoqueItemMetricas | null {
  const entry = metricasCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    metricasCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedMetricas(cacheKey: string, data: ControleEstoqueItemMetricas) {
  metricasCache.set(cacheKey, {
    expiresAt: Date.now() + SERVER_CACHE_TTL_MS,
    data,
  });
}

async function getDynamicCompanyConfig(company?: string) {
  const normalizedCompany = normalizeControleEstoqueItemValue(company).toLowerCase();
  if (!normalizedCompany) return null;

  const cached = dynamicCompanyCache.get(normalizedCompany);
  if (cached) {
    return cached;
  }

  const promise = resolveCompanyDynamic(normalizedCompany)
    .catch(() => resolveCompany(normalizedCompany))
    .then((config) => config ?? resolveCompany(normalizedCompany));

  dynamicCompanyCache.set(normalizedCompany, promise);
  return promise;
}

async function resolveEstoqueFilialScope(company?: string, filial?: string | null): Promise<string | null> {
  const normalizedFilial = normalizeControleEstoqueItemValue(filial);
  if (!normalizedFilial || normalizedFilial === VAREJO_VALUE) {
    return filial ?? null;
  }

  const companyConfig = await getDynamicCompanyConfig(company);
  if (!companyConfig) {
    return filial ?? null;
  }

  const members = getFilialGroupMembers(companyConfig, normalizedFilial);
  if (members.length <= 1) {
    return normalizedFilial;
  }

  return getActiveFilial(companyConfig, normalizedFilial) || normalizedFilial;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      await worker();
    })
  );

  return results;
}

async function loadControleEstoqueItemMetricas(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  item: ControleEstoqueItemInput;
}): Promise<ControleEstoqueItemMetricas> {
  const produto = normalizeControleEstoqueItemValue(input.item.produto);
  const corProduto = normalizeControleEstoqueItemValue(input.item.corProduto) || null;
  const estoqueFilialScope = await resolveEstoqueFilialScope(input.company, input.filial ?? null);

  const [estoquePorFilial, vendasPorFilialResult] = await Promise.all([
    fetchEstoqueProdutoPorFilial({
      company: input.company,
      filial: estoqueFilialScope,
      produto,
      corProduto,
    }),
    fetchVendasProdutoPorFilial({
      company: input.company,
      filial: input.filial ?? null,
      produto,
      corProduto,
      includeHistoricoRows: Boolean(input.includeHistorico),
    }),
  ]);
  const vendasPorFilialRaw = vendasPorFilialResult.rows;

  const vendasPorFilial = vendasPorFilialRaw.map((row) => ({
    filial: row.filial,
    qtde12m: Number(row.qtde12m ?? 0),
    qtde60d: Number(row.qtde60d ?? 0),
    qtdeMesAtual: Number(row.qtdeMesAtual ?? 0),
    valor12m: Number(row.valor12m ?? 0),
    custoUnitario: Number(row.custoUnitario ?? 0),
    diasDesdeUltimaVenda: row.diasDesdeUltimaVenda ?? null,
    primeiraEntradaFilial: row.primeiraEntradaFilial
      ? new Date(row.primeiraEntradaFilial).toISOString()
      : null,
    diasHistoricoFilial: Number(row.diasHistoricoFilial ?? 365),
    mesesHistoricoFilial: Number(row.mesesHistoricoFilial ?? 12),
    historicoParcial: Boolean(row.historicoParcial),
    diasComEstoquePositivo: Number(row.diasComEstoquePositivo ?? 0),
    diasSemEstoque: Number(row.diasSemEstoque ?? 365),
    mesesDisponiveis: Number(row.mesesDisponiveis ?? 1),
    velocidadeAjustada: Number(row.velocidadeAjustada ?? 0),
  }));

  const resumo = summarizeControleEstoqueItemMetricas({
    estoquePorFilial,
    vendasPorFilial,
  });

  return {
    item: { produto, corProduto },
    estoquePorFilial: estoquePorFilial.map((row) => ({
      filial: row.filial,
      estoque: Number(row.estoque ?? 0),
    })),
    vendasPorFilial,
    resumo: {
      ...resumo,
      diasComEstoquePositivo: Number(vendasPorFilialResult.resumoDisponibilidade.diasComEstoquePositivo ?? 0),
      diasSemEstoque: Number(vendasPorFilialResult.resumoDisponibilidade.diasSemEstoque ?? 365),
      mesesDisponiveis: Number(vendasPorFilialResult.resumoDisponibilidade.mesesDisponiveis ?? 1),
      velocidadeAjustada: Number(vendasPorFilialResult.resumoDisponibilidade.velocidadeAjustada ?? 0),
    },
  };
}

export async function getControleEstoqueItemMetricas(input: {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  item: ControleEstoqueItemInput;
}): Promise<ControleEstoqueItemMetricas> {
  const cacheKey = buildScopeCacheKey(input);
  const cached = getCachedMetricas(cacheKey);
  if (cached) return cached;

  const inFlight = metricasInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = loadControleEstoqueItemMetricas(input)
    .then((data) => {
      setCachedMetricas(cacheKey, data);
      metricasInFlight.delete(cacheKey);
      return data;
    })
    .catch((error) => {
      metricasInFlight.delete(cacheKey);
      throw error;
    });

  metricasInFlight.set(cacheKey, promise);
  return promise;
}

export async function getControleEstoqueMetricasItens(
  input: ControleEstoqueMetricasItensPayload
): Promise<Record<string, ControleEstoqueItemMetricas>> {
  const itens = dedupeControleEstoqueItens(input.itens ?? []);
  const results = await mapWithConcurrency(itens, SERVER_BATCH_CONCURRENCY, async (item) => {
    try {
      const data = await getControleEstoqueItemMetricas({
        company: input.company,
        filial: input.filial ?? null,
        includeHistorico: input.includeHistorico,
        item,
      });
      return [buildControleEstoqueItemKey(item.produto, item.corProduto), data] as const;
    } catch (error) {
      console.warn("[getControleEstoqueMetricasItens] Falha ao carregar item do lote", {
        company: input.company ?? null,
        filial: input.filial ?? null,
        produto: item.produto,
        corProduto: item.corProduto ?? null,
        error,
      });
      return null;
    }
  });

  return Object.fromEntries(results.filter((entry): entry is NonNullable<(typeof results)[number]> => entry != null));
}
