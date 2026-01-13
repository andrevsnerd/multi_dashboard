import { NextResponse } from 'next/server';

import { fetchDetalhesCategoria } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const categoria = searchParams.get('categoria');
  const produto = searchParams.get('produto');
  const filial = searchParams.get('filial') || null;
  const grupos = searchParams.get('grupos')?.split(',').filter(Boolean) || [];
  const linhas = searchParams.get('linhas')?.split(',').filter(Boolean) || [];
  const colecoes = searchParams.get('colecoes')?.split(',').filter(Boolean) || [];
  const subgrupos = searchParams.get('subgrupos')?.split(',').filter(Boolean) || [];
  const grades = searchParams.get('grades')?.split(',').filter(Boolean) || [];

  if (!company || !categoria) {
    return NextResponse.json(
      { error: 'Parâmetros company e categoria são obrigatórios' },
      { status: 400 }
    );
  }

  try {
    const detalhes = await fetchDetalhesCategoria({
      company,
      categoria: decodeURIComponent(categoria),
      produto: produto ? decodeURIComponent(produto) : undefined,
      filial,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes da categoria', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes da categoria' },
      { status: 500 }
    );
  }
}
