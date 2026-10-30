import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { reverterLotePrecosCor } from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Desfaz um lote de preço por cor: devolve o preço de cada cor e, se o lote converteu o
 * produto, desliga o preço por cor (o PDV volta a ler o preço do produto, que não mudou).
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; lote?: string };
    const company = parsePrecoCompany(body.company);
    const lote = (body.lote ?? '').trim();
    if (!company || !lote) {
      return NextResponse.json({ error: 'Empresa e lote são obrigatórios.' }, { status: 400 });
    }
    return NextResponse.json(await reverterLotePrecosCor(lote, company, autorizacao.auth.username));
  } catch (error) {
    console.error('[precos/tarefas/reverter-cor] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao desfazer o lote.' },
      { status: 500 }
    );
  }
}
