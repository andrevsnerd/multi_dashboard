import { NextResponse } from 'next/server';

import { autorizarPrecos } from '@/lib/auth/precos-guard';
import { criarCustoFaltante } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  company?: string;
  produto?: string;
  custo?: number | string;
  obs?: string | null;
}

/**
 * Cria a linha da tabela de CUSTO de um produto que foi cadastrado sem ela
 * (custo de reposição 0). Só cria — produto que já tem custo vai pelo
 * Alterar Custo / Preço.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = body.company === 'nerd' || body.company === 'scarfme' ? body.company : null;
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    const custo = Number(String(body.custo ?? '').replace(',', '.'));
    const resultado = await criarCustoFaltante({
      company,
      usuario: autorizacao.auth.username,
      produto: body.produto ?? '',
      custo,
      obs: typeof body.obs === 'string' ? body.obs : null,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[precos/custo-faltante] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar o custo.' },
      { status: 500 }
    );
  }
}
