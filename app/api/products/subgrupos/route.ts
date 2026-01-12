import { NextResponse } from 'next/server';

import { fetchAvailableSubgrupos } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  // Extrair filtros dependentes
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

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
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      grades: grades.length > 0 ? grades : null,
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

