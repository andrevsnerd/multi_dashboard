import { NextResponse } from 'next/server';

import { fetchSalesSummary } from '@/lib/repositories/sales';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
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
    const {
      summary,
      currentPeriodLastSaleDate,
      availableRange,
    } = await fetchSalesSummary({
      company,
      range,
    });

    return NextResponse.json({
      data: summary,
      lastAvailableDate: currentPeriodLastSaleDate?.toISOString() ?? null,
      availableRange: {
        start: availableRange.start ? availableRange.start.toISOString() : null,
        end: availableRange.end ? availableRange.end.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('Erro ao carregar resumo de vendas', error);
    return NextResponse.json(
      { error: 'Erro ao carregar resumo de vendas' },
      { status: 500 }
    );
  }
}



