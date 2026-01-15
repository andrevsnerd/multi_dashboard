import { NextResponse } from 'next/server';

import { fetchProdutoDetalhesPorFilial } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produtoNome = searchParams.get('produtoNome') || undefined;
  const linha = searchParams.get('linha') || undefined;
  const subgrupo = searchParams.get('subgrupo') || undefined;
  const grade = searchParams.get('grade') || undefined;
  const colecao = searchParams.get('colecao') || undefined;

  try {
    const detalhes = await fetchProdutoDetalhesPorFilial({
      company,
      filial,
      produtoNome,
      linha,
      subgrupo,
      grade,
      colecao,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto por filial:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do produto por filial' },
      { status: 500 }
    );
  }
}
