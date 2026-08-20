import { NextResponse } from 'next/server';

import { autorizarCores, parseCorCompany } from '@/lib/auth/cores-guard';
import { adicionarCorAoProduto } from '@/lib/repositories/produtoCores';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  company?: string;
  produto?: string;
  cor?: string;
  descCor?: string;
  obs?: string | null;
}

/**
 * Cria a cor no cadastro do Linx com os códigos de barra (interno + EAN-13) de
 * cada tamanho da grade — o mesmo processo da tela de cadastro do ERP.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarCores(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCorCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }

    const resultado = await adicionarCorAoProduto({
      company,
      usuario: autorizacao.auth.username,
      produto: (body.produto ?? '').trim(),
      cor: (body.cor ?? '').trim(),
      descCor: (body.descCor ?? '').trim(),
      obs: typeof body.obs === 'string' ? body.obs : null,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[etiquetas/cores/adicionar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar a cor.' },
      { status: 500 }
    );
  }
}
