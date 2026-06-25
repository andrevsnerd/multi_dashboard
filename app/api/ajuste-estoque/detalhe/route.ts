import { NextResponse } from 'next/server';

import { detalharAjuste } from '@/lib/repositories/ajusteEstoque';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const nome = searchParams.get('nome')?.trim();
    if (!nome) {
      return NextResponse.json({ error: 'Informe a contagem.' }, { status: 400 });
    }
    const itens = await detalharAjuste(nome);
    return NextResponse.json({ nome, itens });
  } catch (error) {
    console.error('[ajuste-estoque/detalhe] erro', error);
    return NextResponse.json({ error: 'Erro ao carregar detalhe.' }, { status: 500 });
  }
}
