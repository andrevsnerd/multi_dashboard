import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { fetchHistoricoLinhas, fetchHistoricoLotes } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Lotes recentes de alteração (ou as linhas de um lote, com `?lote=`). */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parsePrecoCompany(searchParams.get('company'));
  if (!company) {
    return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
  }

  const lote = searchParams.get('lote')?.trim();

  try {
    if (lote) {
      const linhas = await fetchHistoricoLinhas(lote);
      return NextResponse.json({ linhas: linhas.filter((l) => l.empresa === company) });
    }
    const lotes = await fetchHistoricoLotes(company, Number(searchParams.get('limite') ?? 30));
    return NextResponse.json({ lotes, podeExecutar: autorizacao.auth.podeExecutar });
  } catch (error) {
    console.error('[precos/historico] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar histórico.' },
      { status: 500 }
    );
  }
}
