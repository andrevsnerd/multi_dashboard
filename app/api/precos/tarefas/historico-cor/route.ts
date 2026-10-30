import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { fetchHistoricoLotesCor } from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Lotes de preço por cor (NERD_PRECO_COR_HISTORICO). A tela junta com os lotes por produto. */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parsePrecoCompany(searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  try {
    const lotes = await fetchHistoricoLotesCor(company, Number(searchParams.get('limite') ?? 30));
    return NextResponse.json({ lotes });
  } catch (error) {
    console.error('[precos/tarefas/historico-cor] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar o histórico por cor.' },
      { status: 500 }
    );
  }
}
