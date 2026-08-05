import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { fetchHistoricoLinhas, fetchHistoricoLotes } from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Lotes recentes de alteração de cadastro (ou as linhas de um lote, com `?lote=`). */
export async function GET(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parseCadastroCompany(searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  const lote = searchParams.get('lote')?.trim();

  try {
    if (lote) {
      const linhas = await fetchHistoricoLinhas(lote);
      return NextResponse.json({ linhas: linhas.filter((l) => l.empresa === company) });
    }
    const lotes = await fetchHistoricoLotes(company, Number(searchParams.get('limite') ?? 30));
    return NextResponse.json({ lotes, podeExecutar: autorizacao.auth.podeExecutar });
  } catch (error) {
    console.error('[cadastro/historico] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar histórico.' },
      { status: 500 }
    );
  }
}
