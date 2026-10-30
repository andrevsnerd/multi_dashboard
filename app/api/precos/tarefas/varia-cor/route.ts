import { NextResponse } from 'next/server';

import { autorizarPrecos } from '@/lib/auth/precos-guard';
import { fetchFlagsLoja } from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Quais produtos já têm preço por cor (modo por produto não chega ao PDV deles) e quais
 * não vão para as lojas (não LIBERADO ou ENVIA_LOJA_VAREJO desligado).
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { produtos?: string[] };
    const produtos = Array.isArray(body.produtos) ? body.produtos.map((p) => String(p ?? '').trim()).filter(Boolean) : [];
    return NextResponse.json(
      produtos.length > 0 ? await fetchFlagsLoja(produtos) : { variaPorCor: [], naoVaoParaLoja: [] }
    );
  } catch (error) {
    console.error('[precos/tarefas/varia-cor] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao conferir preço por cor.' },
      { status: 500 }
    );
  }
}
