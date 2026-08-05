import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import {
  executarAlteracaoCadastro,
  type AlteracaoProdutoInput,
} from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  company?: string;
  alteracoes?: AlteracaoProdutoInput[];
  obs?: string | null;
}

/** Aplica as alterações de campo do produto no cadastro do Linx. */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCadastroCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    if (!Array.isArray(body.alteracoes) || body.alteracoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
    }

    const resultado = await executarAlteracaoCadastro({
      company,
      usuario: autorizacao.auth.username,
      alteracoes: body.alteracoes,
      obs: typeof body.obs === 'string' ? body.obs : null,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[cadastro/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao aplicar alterações.' },
      { status: 500 }
    );
  }
}
