import { NextResponse } from 'next/server';

import { fetchAvailableGrades } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  // Extrair filtros dependentes
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);

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
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
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

