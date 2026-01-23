import { NextResponse } from 'next/server';

import { fetchControleMovimentoKPIs } from '@/lib/repositories/controleMovimento';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const filial = searchParams.get('filial') || null;

  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  const range = startParam && endParam
    ? { start: startParam, end: endParam }
    : undefined;

  // Extrair filtros múltiplos
  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  if (!company) {
    return NextResponse.json(
      { error: 'Parâmetro company é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const kpis = await fetchControleMovimentoKPIs({
      company,
      filial,
      range,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
    });

    return NextResponse.json({ data: kpis });
  } catch (error) {
    console.error('Erro ao buscar KPIs de controle de movimento:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar dados de controle de movimento' },
      { status: 500 }
    );
  }
}
