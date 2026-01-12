import { NextResponse } from 'next/server';

import {
  fetchEstoqueKPIs,
  fetchEstoquePorCategoria,
  fetchEvolucaoEstoque,
  fetchVendasPorCategoria,
  fetchPrevisoesEstoque,
} from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const periodType = (searchParams.get('periodType') as 'semanal' | 'mensal') || 'semanal';
  const dataType = searchParams.get('dataType'); // 'kpis', 'categorias', 'evolucao', 'vendas', 'previsoes'

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

  const filters = {
    grupos: grupos.length > 0 ? grupos : null,
    linhas: linhas.length > 0 ? linhas : null,
    colecoes: colecoes.length > 0 ? colecoes : null,
    subgrupos: subgrupos.length > 0 ? subgrupos : null,
    grades: grades.length > 0 ? grades : null,
  };

  try {
    switch (dataType) {
      case 'kpis': {
        const kpis = await fetchEstoqueKPIs({ company, filial, range, ...filters });
        return NextResponse.json({ data: kpis });
      }
      case 'categorias': {
        const categorias = await fetchEstoquePorCategoria({ company, filial, range, periodType, ...filters });
        return NextResponse.json({ data: categorias });
      }
      case 'evolucao': {
        const evolucao = await fetchEvolucaoEstoque({ company, filial, range, periodType, ...filters });
        return NextResponse.json({ data: evolucao });
      }
      case 'vendas': {
        const vendas = await fetchVendasPorCategoria({ company, filial, range, ...filters });
        return NextResponse.json({ data: vendas });
      }
      case 'previsoes': {
        const previsoes = await fetchPrevisoesEstoque({ company, filial, range, ...filters });
        return NextResponse.json({ data: previsoes });
      }
      default:
        return NextResponse.json(
          { error: 'Tipo de dados inválido. Use: kpis, categorias, evolucao, vendas ou previsoes' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Erro ao carregar dados de controle de estoque:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar dados de controle de estoque' },
      { status: 500 }
    );
  }
}
