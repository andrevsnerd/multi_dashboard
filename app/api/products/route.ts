import { NextResponse } from 'next/server';

import { fetchProductsWithDetails, type ProductDetail } from '@/lib/repositories/products';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  
  // Obter todos os valores para cada filtro (suporta múltiplos)
  const grupos = searchParams.getAll('grupo');
  const linhas = searchParams.getAll('linha');
  const colecoes = searchParams.getAll('colecao');
  const subgrupos = searchParams.getAll('subgrupo');
  const grades = searchParams.getAll('grade');
  const produtoId = searchParams.get('produtoId');
  const produtoSearchTerm = searchParams.get('produtoSearchTerm');
  
  const groupByColorParam = searchParams.get('groupByColor');
  const acimaDoTicketParam = searchParams.get('acimaDoTicket');
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

  const groupByColor = groupByColorParam === 'true';
  const acimaDoTicket = acimaDoTicketParam === 'true';

  try {
    const data = await fetchProductsWithDetails({
      company,
      range,
      filial: filial || null,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
      groupByColor,
      produtoId: produtoId || undefined,
      produtoSearchTerm: produtoSearchTerm || undefined,
      acimaDoTicket,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos', error);
    return NextResponse.json(
      { error: 'Erro ao carregar produtos' },
      { status: 500 }
    );
  }
}

