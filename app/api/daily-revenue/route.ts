import { NextResponse } from 'next/server';

import { fetchDailyRevenue } from '@/lib/repositories/sales';

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
    const data = await fetchDailyRevenue({
      company,
      range,
      filial: filial || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar faturamento diário', error);
    return NextResponse.json(
      { error: 'Erro ao carregar faturamento diário' },
      { status: 500 }
    );
  }
}

