import { NextResponse } from 'next/server';

import { autorizarCadastro } from '@/lib/auth/cadastro-guard';
import { fetchModeloProduto } from '@/lib/repositories/produtoNovo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Ficha de um produto existente, para usar de modelo no cadastro novo. */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { produto?: string };
    const modelo = await fetchModeloProduto(body.produto ?? '');
    return NextResponse.json(modelo);
  } catch (error) {
    console.error('[produto-novo/modelo] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar o produto modelo.' },
      { status: 500 }
    );
  }
}
