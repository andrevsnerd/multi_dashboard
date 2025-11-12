import { NextResponse } from 'next/server';

import { fetchTopProducts } from '@/lib/repositories/sales';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? '');
  const days = Number(searchParams.get('days') ?? '');
  const company = searchParams.get('company') ?? undefined;

  try {
    const data = await fetchTopProducts({
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      company,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar top produtos', error);
    return NextResponse.json(
      { error: 'Erro ao carregar top produtos' },
      { status: 500 }
    );
  }
}


