import { NextResponse } from 'next/server';

import { fetchProdutoDetalhes } from '@/lib/repositories/controleEstoque';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produtoNome = searchParams.get('produtoNome') || undefined;
  const linha = searchParams.get('linha') || undefined;
  const grupo = searchParams.get('grupo') ?? undefined;
  const subgrupo = searchParams.get('subgrupo') || undefined;
  const grade = searchParams.get('grade') || undefined;
  const colecao = searchParams.get('colecao') || undefined;
  const giroDias = searchParams.get('giroDias');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let filtrarApenasComVendas = false;
  if (giroDias && startParam && endParam) {
    const start = new Date(startParam);
    const end = new Date(endParam);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const { start: startNorm, end: endNorm } = normalizeRangeForQuery({ start, end });
      startDate = startNorm;
      endDate = endNorm;
      filtrarApenasComVendas = true;
    }
  }

  try {
    const detalhes = await fetchProdutoDetalhes({
      company,
      filial,
      produtoNome,
      linha,
      grupo,
      subgrupo,
      grade,
      colecao,
      startDate,
      endDate,
      filtrarApenasComVendas,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do produto' },
      { status: 500 }
    );
  }
}
