import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { fetchOpcoesProdutoNovo } from '@/lib/repositories/produtoNovo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Tudo que a tela de cadastro precisa de uma vez: listas das mestres, catálogo
 * de cores, padrões por grupo e as tabelas de preço que o trigger vai derivar.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const company = parseCadastroCompany(new URL(request.url).searchParams.get('company'));
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

    const opcoes = await fetchOpcoesProdutoNovo(company);
    return NextResponse.json({ ...opcoes, podeExecutar: autorizacao.auth.podeExecutar });
  } catch (error) {
    console.error('[produto-novo/opcoes] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar as opções do cadastro.' },
      { status: 500 }
    );
  }
}
