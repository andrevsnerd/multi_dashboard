import { NextResponse } from 'next/server';

import { fetchAvailableColecoes, fetchAvailableColecoesWithDescriptions } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const includeDescriptions = searchParams.get('includeDescriptions') === '1';

  // Extrair filtros dependentes
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
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
    const data = includeDescriptions
      ? await fetchAvailableColecoesWithDescriptions({
          company,
          range,
          filial: filial || null,
          linhas: linhas.length > 0 ? linhas : null,
          subgrupos: subgrupos.length > 0 ? subgrupos : null,
          grades: grades.length > 0 ? grades : null,
        })
      : await fetchAvailableColecoes({
          company,
          range,
          filial: filial || null,
          linhas: linhas.length > 0 ? linhas : null,
          subgrupos: subgrupos.length > 0 ? subgrupos : null,
          grades: grades.length > 0 ? grades : null,
        });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar coleções', error);
    return NextResponse.json(
      { error: 'Erro ao carregar coleções' },
      { status: 500 }
    );
  }
}

