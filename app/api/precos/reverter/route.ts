import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { reverterLotePrecos } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Desfaz um lote reaplicando os valores anteriores (novo lote marcado como estorno). */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; lote?: string };
    const company = parsePrecoCompany(body.company);
    const lote = (body.lote ?? '').trim();
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if (!lote) {
      return NextResponse.json({ error: 'Lote não informado.' }, { status: 400 });
    }

    const resultado = await reverterLotePrecos(lote, company, autorizacao.auth.username);
    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[precos/reverter] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao desfazer o lote.' },
      { status: 500 }
    );
  }
}
