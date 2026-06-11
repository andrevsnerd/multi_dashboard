import { NextResponse } from 'next/server';

import { fetchUltimasEntradasPorFilial } from '@/lib/repositories/controleEstoque';

export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const produto = searchParams.get('produto') ?? '';
  const cor = searchParams.get('cor') ?? '';

  if (!produto.trim()) {
    return NextResponse.json({ data: [] });
  }

  try {
    const data = await fetchUltimasEntradasPorFilial({ produto, cor });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar entradas por filial:', error);
    const message = error instanceof Error ? error.message : 'Erro ao carregar dados';
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? message : 'Erro ao carregar dados' },
      { status: 500 }
    );
  }
}
