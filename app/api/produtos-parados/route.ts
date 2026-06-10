import { NextResponse } from 'next/server';

import { fetchProdutosParadosDetalhado } from '@/lib/repositories/controleEstoque';

export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const minDiasParam = searchParams.get('minDias');
  const minDias = minDiasParam ? parseInt(minDiasParam, 10) : 30;

  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  const filters = {
    grupos: grupos.length > 0 ? grupos : null,
    linhas: linhas.length > 0 ? linhas : null,
    colecoes: colecoes.length > 0 ? colecoes : null,
    subgrupos: subgrupos.length > 0 ? subgrupos : null,
    grades: grades.length > 0 ? grades : null,
  };

  try {
    const data = await fetchProdutosParadosDetalhado({
      company,
      filial,
      ...filters,
      minDias: Number.isFinite(minDias) && minDias >= 0 ? minDias : 30,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos parados:', error);
    const message = error instanceof Error ? error.message : 'Erro ao carregar produtos parados';
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? message : 'Erro ao carregar dados' },
      { status: 500 }
    );
  }
}
