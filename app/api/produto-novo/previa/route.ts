import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { fetchPreviaProdutoNovo } from '@/lib/repositories/produtoNovo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  company?: string;
  grupo?: string;
  subgrupo?: string;
  grade?: string;
  descProduto?: string;
  empresa?: number | null;
}

/** Próximo código, últimos do subgrupo, nomes repetidos e tamanhos — só leitura. */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCadastroCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

    const previa = await fetchPreviaProdutoNovo({
      company,
      grupo: body.grupo ?? '',
      subgrupo: body.subgrupo ?? '',
      grade: body.grade ?? '',
      descProduto: body.descProduto ?? '',
      empresa: typeof body.empresa === 'number' ? body.empresa : null,
    });
    return NextResponse.json(previa);
  } catch (error) {
    console.error('[produto-novo/previa] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao montar a prévia.' },
      { status: 500 }
    );
  }
}
