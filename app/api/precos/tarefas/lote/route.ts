import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { fetchLoteDetalhe } from '@/lib/repositories/precosTarefas';
import { fetchLoteCorDetalhe } from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Itens de um lote do histórico, com nome do produto e da tabela (para expandir na tela). */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parsePrecoCompany(searchParams.get('company'));
  const lote = searchParams.get('lote')?.trim();
  if (!company || !lote) {
    return NextResponse.json({ error: 'Empresa e lote são obrigatórios.' }, { status: 400 });
  }

  try {
    // Lote de preço por cor (prefixo PRCC) mora em outra tabela de histórico.
    if (lote.startsWith('PRCC')) return NextResponse.json(await fetchLoteCorDetalhe(lote, company));
    return NextResponse.json({ linhas: await fetchLoteDetalhe(lote, company), convertidos: [] });
  } catch (error) {
    console.error('[precos/tarefas/lote] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar o lote.' },
      { status: 500 }
    );
  }
}
