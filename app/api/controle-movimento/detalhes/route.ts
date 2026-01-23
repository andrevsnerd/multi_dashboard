import { NextResponse } from 'next/server';

import { fetchMovimentoDetalhes } from '@/lib/repositories/controleMovimento';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const tipo = searchParams.get('tipo') as 'entradas' | 'vendidos' | 'parados' | null;
  const filial = searchParams.get('filial') || null;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  // Extrair filtros dependentes
  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  if (!company || !tipo || !startParam || !endParam) {
    return NextResponse.json(
      { error: 'Parâmetros company, tipo, start e end são obrigatórios' },
      { status: 400 }
    );
  }

  const range = {
    start: startParam,
    end: endParam,
  };

  try {
    const detalhes = await fetchMovimentoDetalhes({
      company,
      tipo,
      range,
      filial: filial || null,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes do movimento:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do movimento' },
      { status: 500 }
    );
  }
}
