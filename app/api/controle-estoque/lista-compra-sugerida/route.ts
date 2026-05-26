import { NextResponse } from 'next/server';

import { fetchTopProdutosUltimos3Meses } from '@/lib/repositories/controleEstoque';

export const maxDuration = 60;

const RESPONSE_CACHE_TTL_MS = 30 * 1000;

type ListaCompraResponseData = Awaited<ReturnType<typeof fetchTopProdutosUltimos3Meses>>;

type CacheEntry = {
  expiresAt: number;
  data: ListaCompraResponseData;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<ListaCompraResponseData>>();

function normalizeSearchParams(searchParams: URLSearchParams): string {
  return Array.from(searchParams.entries())
    .sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA === keyB) {
        return valueA.localeCompare(valueB);
      }
      return keyA.localeCompare(keyB);
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function getCachedResponse(cacheKey: string): ListaCompraResponseData | null {
  const cached = responseCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function setCachedResponse(cacheKey: string, data: ListaCompraResponseData) {
  responseCache.set(cacheKey, {
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    data,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cacheKey = normalizeSearchParams(searchParams);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const categoria = searchParams.get('categoria') || null;
  const qtdCompra = Number(searchParams.get('qtdCompra') ?? '0');
  const limit = Number(searchParams.get('limit') ?? '50');
  const porCor = searchParams.get('porCor') === '1' || searchParams.get('porCor') === 'true';
  const includeHistorico =
    searchParams.get('includeHistorico') === '1' ||
    searchParams.get('includeHistorico') === 'true';

  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);
  const produtos = searchParams.getAll('produtos').filter(Boolean);

  try {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ data: cached });
    }

    const existingRequest = inFlightRequests.get(cacheKey);
    if (existingRequest) {
      const data = await existingRequest;
      return NextResponse.json({ data });
    }

    const dataPromise = fetchTopProdutosUltimos3Meses({
      company,
      filial,
      categoria,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
      produtos: produtos.length > 0 ? produtos : null,
      qtdCompra,
      porCor,
      includeHistorico,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    })
      .then((data) => {
        setCachedResponse(cacheKey, data);
        inFlightRequests.delete(cacheKey);
        return data;
      })
      .catch((error) => {
        inFlightRequests.delete(cacheKey);
        throw error;
      });

    inFlightRequests.set(cacheKey, dataPromise);
    const data = await dataPromise;

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar lista de compra sugerida', error);
    return NextResponse.json(
      { error: 'Erro ao carregar lista de compra sugerida' },
      { status: 500 }
    );
  }
}
