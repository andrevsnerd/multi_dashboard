import { NextResponse } from 'next/server';

import { fetchProdutoDetalhesPorFilial } from '@/lib/repositories/controleEstoque';

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
  const cor = searchParams.get('cor') || undefined;

  try {
    const detalhes = await fetchProdutoDetalhesPorFilial({
      company,
      filial,
      produtoNome,
      linha,
      grupo, // Para NERD
      subgrupo,
      grade,
      colecao,
      cor,
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

/** POST: recebe produtosPermitidos no body (do cache do giro) → resposta rápida com WHERE IN. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const company = body.company ?? undefined;
    const filial = body.filial ?? null;
    const produtoNome = body.produtoNome ?? undefined;
    const linha = body.linha ?? undefined;
    const grupo = body.grupo ?? undefined;
    const subgrupo = body.subgrupo ?? undefined;
    const grade = body.grade ?? undefined;
    const colecao = body.colecao ?? undefined;
    const cor = body.cor ?? undefined;
    const produtosPermitidos = Array.isArray(body.produtosPermitidos) ? body.produtosPermitidos : undefined;

    const detalhes = await fetchProdutoDetalhesPorFilial({
      company,
      filial,
      produtoNome,
      linha,
      grupo,
      subgrupo,
      grade,
      colecao,
      cor,
      produtosPermitidos,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto por filial (POST):', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do produto por filial' },
      { status: 500 }
    );
  }
}
