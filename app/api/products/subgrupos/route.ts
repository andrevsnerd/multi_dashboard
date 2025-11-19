import { NextResponse } from 'next/server';

import { fetchAvailableSubgrupos } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: 'Parâmetros start e end são obrigatórios' },
      { status: 400 }
    );
  }

  const range = {
    start: startParam,
    end: endParam,
  };

  try {
    const data = await fetchAvailableSubgrupos({
      company,
      range,
      filial: filial || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar subgrupos', error);
    return NextResponse.json(
      { error: 'Erro ao carregar subgrupos' },
      { status: 500 }
    );
  }
}

