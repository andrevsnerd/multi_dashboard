import { NextResponse } from 'next/server';

import { fetchAvailableGrades } from '@/lib/repositories/products';

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
    const data = await fetchAvailableGrades({
      company,
      range,
      filial: filial || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar grades', error);
    return NextResponse.json(
      { error: 'Erro ao carregar grades' },
      { status: 500 }
    );
  }
}

