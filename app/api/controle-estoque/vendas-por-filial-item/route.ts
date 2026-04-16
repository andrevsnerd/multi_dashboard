import { NextResponse } from 'next/server';

import { fetchVendasProdutoPorFilial } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produto = searchParams.get('produto') || '';
  const corProduto = searchParams.get('corProduto');
  const includeHistoricoRows = searchParams.get('includeHistorico') === 'true';

  if (!produto.trim()) {
    return NextResponse.json({ error: 'Parâmetro produto é obrigatório' }, { status: 400 });
  }

  try {
    const data = await fetchVendasProdutoPorFilial({
      company,
      filial,
      produto,
      corProduto: corProduto != null ? corProduto : null,
      includeHistoricoRows,
    });
    // data inclui: filial, qtde12m, qtde60d, qtdeMesAtual, valor12m, custoUnitario e historico por filial quando solicitado
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar vendas por filial do item', error);
    return NextResponse.json(
      { error: 'Erro ao carregar vendas por filial do item' },
      { status: 500 }
    );
  }
}
