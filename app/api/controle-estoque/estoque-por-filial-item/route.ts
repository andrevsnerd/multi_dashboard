import { NextResponse } from 'next/server';

import { fetchEstoqueProdutoPorFilial } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produto = searchParams.get('produto') || '';
  const corProduto = searchParams.get('corProduto');

  if (!produto.trim()) {
    return NextResponse.json({ error: 'Parâmetro produto é obrigatório' }, { status: 400 });
  }

  try {
    const data = await fetchEstoqueProdutoPorFilial({
      company,
      filial,
      produto,
      corProduto: corProduto != null ? corProduto : null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar estoque por filial do item', error);
    return NextResponse.json(
      { error: 'Erro ao carregar estoque por filial do item' },
      { status: 500 }
    );
  }
}

