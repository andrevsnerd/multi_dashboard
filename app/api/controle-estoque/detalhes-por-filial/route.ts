import { NextResponse } from 'next/server';

import { fetchProdutoDetalhesPorFilial } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produtoNome = searchParams.get('produtoNome') || undefined;
  const itensBuscaRaw = searchParams.get('itens') || undefined;
  const buscaItens = itensBuscaRaw
    ? itensBuscaRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const linha = searchParams.get('linha') || undefined;
  const grupo = searchParams.get('grupo') || undefined; // Para NERD
  const subgrupo = searchParams.get('subgrupo') || undefined;
  const grade = searchParams.get('grade') || undefined;
  const colecao = searchParams.get('colecao') || undefined;
  const cor = searchParams.get('cor') || undefined;
  const mostrarZerados =
    searchParams.get('mostrarZerados') === '1' ||
    searchParams.get('mostrarZerados') === 'true';
  const mostrarNegativos =
    searchParams.get('mostrarNegativos') === '1' ||
    searchParams.get('mostrarNegativos') === 'true';

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
      buscaItens: buscaItens && buscaItens.length > 0 ? buscaItens : undefined,
      mostrarZerados,
      mostrarNegativos,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao carregar detalhes do produto por filial';
    console.error('Erro ao carregar detalhes do produto por filial:', error);
    const status = message.includes('Informe itens') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** POST: recebe produtosPermitidos no body (do cache do giro) → resposta rápida com WHERE IN. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const company = body.company ?? undefined;
    const filial = body.filial ?? null;
    const produtoNome = body.produtoNome ?? undefined;
    const itensRaw = body.itens;
    const buscaItens = Array.isArray(itensRaw)
      ? itensRaw.map((s: unknown) => String(s).trim()).filter(Boolean)
      : typeof itensRaw === 'string'
        ? itensRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;
    const linha = body.linha ?? undefined;
    const grupo = body.grupo ?? undefined;
    const subgrupo = body.subgrupo ?? undefined;
    const grade = body.grade ?? undefined;
    const colecao = body.colecao ?? undefined;
    const cor = body.cor ?? undefined;
    const produtosPermitidos = Array.isArray(body.produtosPermitidos) ? body.produtosPermitidos : undefined;
    const mostrarZerados = body.mostrarZerados === true || body.mostrarZerados === '1' || body.mostrarZerados === 'true';
    const mostrarNegativos =
      body.mostrarNegativos === true || body.mostrarNegativos === '1' || body.mostrarNegativos === 'true';

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
      buscaItens: buscaItens && buscaItens.length > 0 ? buscaItens : undefined,
      mostrarZerados,
      mostrarNegativos,
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao carregar detalhes do produto por filial';
    console.error('Erro ao carregar detalhes do produto por filial (POST):', error);
    const status = message.includes('Informe itens') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
