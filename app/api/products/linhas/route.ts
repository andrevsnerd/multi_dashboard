import { NextResponse } from 'next/server';

import { fetchAvailableLinhas } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  // Extrair filtros dependentes
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  // start/end opcionais: quando omitidos, o repositório usa o mês corrente (ex.: Projeção de Estoque)
  const range =
    startParam && endParam
      ? { start: startParam, end: endParam }
      : undefined;

  try {
    const data = await fetchAvailableLinhas({
      company,
      range,
      filial: filial || null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar linhas', error);
    return NextResponse.json(
      { error: 'Erro ao carregar linhas' },
      { status: 500 }
    );
  }
}

