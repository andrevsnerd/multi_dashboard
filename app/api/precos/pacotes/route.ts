import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { analisarPacotesLojas } from '@/lib/repositories/pacotesLojas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** "Já chegou na loja?": fila do ETL e pacotes pendentes de cada loja para um lote ou códigos. */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; lote?: string | null; codigos?: string[] };
    const company = parsePrecoCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    const analise = await analisarPacotesLojas({
      company,
      lote: body.lote ?? null,
      codigos: Array.isArray(body.codigos) ? body.codigos : [],
    });
    return NextResponse.json(analise);
  } catch (error) {
    console.error('[precos/pacotes] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao analisar os pacotes.' },
      { status: 500 }
    );
  }
}
