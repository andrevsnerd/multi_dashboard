import { NextResponse } from 'next/server';

import { fetchAvailableCores } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  // Recorte opcional por produto: cor é escopada por produto no Linx, então quem já escolheu
  // os itens não deve ver o mapa global de cores. Aceita `?produto=a&produto=b`, `?produtos=a,b`
  // e a busca livre por nome (`?busca=`), as mesmas chaves da Projeção Compra.
  const produtoIds = Array.from(
    new Set(
      [...searchParams.getAll('produto'), ...(searchParams.get('produtos') ?? '').split(',')]
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );
  const busca = (searchParams.get('busca') ?? '').trim();

  try {
    const data = await fetchAvailableCores({
      company,
      filial,
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
      produtoSearchTerm: busca || null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar cores', error);
    return NextResponse.json({ error: 'Erro ao carregar cores' }, { status: 500 });
  }
}
