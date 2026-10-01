import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import {
  criarProdutoNovo,
  type CamposProdutoNovo,
  type CorProdutoNovo,
} from '@/lib/repositories/produtoNovo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  company?: string;
  campos?: CamposProdutoNovo;
  cores?: CorProdutoNovo[];
  venda?: string | number;
  custo?: string | number;
  permitirNomeRepetido?: boolean;
  /** Roda o batch inteiro no Linx e desfaz no fim — valida sem gravar. */
  ensaio?: boolean;
  obs?: string | null;
}

/** Cadastra o produto no Linx: ficha + cores + códigos de barra + preços, atômico. */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCadastroCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    if (!body.campos) return NextResponse.json({ error: 'Ficha do produto não informada.' }, { status: 400 });

    const resultado = await criarProdutoNovo({
      company,
      usuario: autorizacao.auth.username,
      campos: body.campos,
      cores: Array.isArray(body.cores) ? body.cores : [],
      venda: body.venda,
      custo: body.custo,
      permitirNomeRepetido: Boolean(body.permitirNomeRepetido),
      ensaio: Boolean(body.ensaio),
      obs: typeof body.obs === 'string' ? body.obs : null,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[produto-novo/criar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao cadastrar o produto.' },
      { status: 500 }
    );
  }
}
