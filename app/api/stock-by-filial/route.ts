import { NextResponse } from 'next/server';

import { fetchStockByFilial } from '@/lib/repositories/stockByFilial';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    const data = await fetchStockByFilial({
      company,
      filial: filial || null,
      range,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar estoque por filial', error);
    return NextResponse.json(
      { error: 'Erro ao carregar estoque por filial' },
      { status: 500 }
    );
  }
}

