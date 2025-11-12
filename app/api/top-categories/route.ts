import { NextResponse } from 'next/server';

import { fetchTopCategories } from '@/lib/repositories/sales';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? '');
  const company = searchParams.get('company') ?? undefined;
  const periodParam = searchParams.get('period');
  const period = periodParam === 'current-month' ? 'current-month' : undefined;

  try {
    const data = await fetchTopCategories({
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      company,
      period,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar top categorias', error);
    return NextResponse.json(
      { error: 'Erro ao carregar top categorias' },
      { status: 500 }
    );
  }
}


