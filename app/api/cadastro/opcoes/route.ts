import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import {
  fetchOpcoesDimensoes,
  listarCamposProduto,
  listarDimensoesMeta,
} from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Tudo o que as telas de cadastro precisam para montar os seletores: valores
 * válidos de cada dimensão (lidos das MESTRES, que é o que a FK valida), o
 * catálogo de campos alteráveis do produto e os metadados de cada dimensão.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parseCadastroCompany(searchParams.get('company'));
  if (!company) {
    return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
  }

  const incluirInativos = searchParams.get('incluirInativos') === '1';

  try {
    const opcoes = await fetchOpcoesDimensoes({ incluirInativos });
    return NextResponse.json({
      opcoes,
      campos: listarCamposProduto(),
      dimensoes: listarDimensoesMeta(),
      podeExecutar: autorizacao.auth.podeExecutar,
    });
  } catch (error) {
    console.error('[cadastro/opcoes] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar opções.' },
      { status: 500 }
    );
  }
}
