import { NextResponse } from 'next/server';

import { fetchTopCategories } from '@/lib/repositories/sales';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? '');
  const days = Number(searchParams.get('days') ?? '');
  const company = searchParams.get('company') ?? undefined;

  try {
    const data = await fetchTopCategories({
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      company,
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


