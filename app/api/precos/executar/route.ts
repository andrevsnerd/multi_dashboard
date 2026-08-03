import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { executarAlteracaoPrecos, type AlteracaoInput } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  company?: string;
  alteracoes?: AlteracaoInput[];
  sincronizarPrecoLiquido?: boolean;
  sincronizarPrecoAVista?: boolean;
  obs?: string | null;
}

/** Aplica as alterações de custo/preço no cadastro do Linx. */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parsePrecoCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if (!Array.isArray(body.alteracoes) || body.alteracoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
    }

    const resultado = await executarAlteracaoPrecos({
      company,
      usuario: autorizacao.auth.username,
      alteracoes: body.alteracoes,
      sincronizarPrecoLiquido: body.sincronizarPrecoLiquido !== false,
      sincronizarPrecoAVista: body.sincronizarPrecoAVista !== false,
      obs: typeof body.obs === 'string' ? body.obs : null,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[precos/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao aplicar alterações.' },
      { status: 500 }
    );
  }
}
