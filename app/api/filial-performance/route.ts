import { NextResponse } from 'next/server';

import { fetchFilialPerformance } from '@/lib/repositories/sales';

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
    const data = await fetchFilialPerformance({
      company,
      range,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar performance por filial', error);
    return NextResponse.json(
      { error: 'Erro ao carregar performance por filial' },
      { status: 500 }
    );
  }
}

