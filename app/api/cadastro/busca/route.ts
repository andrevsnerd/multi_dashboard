import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { buscarProdutosCadastro } from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';

/**
 * Autocomplete da tela Editar Produto (roda a cada pausa de digitação):
 * nome sem ser restritivo, código do produto ou código de barras.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const url = new URL(request.url);
  const company = parseCadastroCompany(url.searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  const termo = (url.searchParams.get('q') ?? '').trim();
  if (termo.length < 2) return NextResponse.json({ produtos: [] });

  try {
    const produtos = await buscarProdutosCadastro(company, termo);
    return NextResponse.json({ produtos });
  } catch (error) {
    console.error('[cadastro/busca] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar produtos.' },
      { status: 500 }
    );
  }
}
