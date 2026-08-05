import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { reverterLoteCadastro } from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Desfaz um lote (novo lote marcado como estorno; nada é apagado). */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; lote?: string };
    const company = parseCadastroCompany(body.company);
    const lote = (body.lote ?? '').trim();
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    if (!lote) return NextResponse.json({ error: 'Lote não informado.' }, { status: 400 });

    const resultado = await reverterLoteCadastro(lote, company, autorizacao.auth.username);
    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[cadastro/reverter] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao desfazer o lote.' },
      { status: 400 }
    );
  }
}
