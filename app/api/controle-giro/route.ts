import { NextResponse } from 'next/server';

import {
  fetchVendasPorCategoriaGiro,
} from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const dataType = searchParams.get('dataType'); // 'kpis', 'categorias'

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
        // Para KPI, vamos calcular o total de vendas
        const vendas = await fetchVendasPorCategoriaGiro({ company, filial, range, ...filters });
        const totalVendas = vendas.reduce((sum, v) => sum + v.vendas, 0);
        const totalVendasVarejo = vendas.reduce((sum, v) => sum + v.vendasVarejo, 0);
        const totalVendasEcommerce = vendas.reduce((sum, v) => sum + v.vendasEcommerce, 0);
        return NextResponse.json({ 
          data: { 
            totalVendas,
            totalVendasVarejo,
            totalVendasEcommerce
          } 
        });
      }
      case 'categorias': {
        // Buscar vendas por categoria com detalhes (linha, subgrupo, grade, coleção)
        const vendas = await fetchVendasPorCategoriaGiro({ company, filial, range, ...filters });
        return NextResponse.json({ data: vendas });
      }
      default:
        return NextResponse.json(
          { error: 'Tipo de dados inválido. Use: kpis ou categorias' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Erro ao carregar dados de controle de giro:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar dados de controle de giro' },
      { status: 500 }
    );
  }
}
