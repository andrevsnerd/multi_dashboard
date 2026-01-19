import { NextResponse } from 'next/server';

import { fetchProdutoDetalhes } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produtoNome = searchParams.get('produtoNome') || undefined;
  const linha = searchParams.get('linha') || undefined;
  const grupo = searchParams.get('grupo') || undefined; // Para NERD
  const subgrupo = searchParams.get('subgrupo') || undefined;
  const grade = searchParams.get('grade') || undefined;
  const colecao = searchParams.get('colecao') || undefined;

  try {
    const detalhes = await fetchProdutoDetalhes({
      company,
      filial,
      produtoNome,
      linha,
      grupo, // Para NERD
      subgrupo,
      grade,
      colecao,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do produto' },
      { status: 500 }
    );
  }
}
