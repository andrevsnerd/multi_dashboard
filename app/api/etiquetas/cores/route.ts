import { NextResponse } from 'next/server';

import { autorizarCores, parseCorCompany } from '@/lib/auth/cores-guard';
import { fetchPreviaAdicionarCor } from '@/lib/repositories/produtoCores';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  company?: string;
  produto?: string;
}

/**
 * Catálogo de cores + prévia do que será criado (tamanhos, próximos códigos).
 * Só leitura: vem tudo de uma vez porque são 450 cores e o filtro por número ou
 * nome roda no cliente, sem ida e volta por tecla.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarCores(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCorCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }

    const produto = (body.produto ?? '').trim();
    if (!produto) {
      return NextResponse.json({ error: 'Informe o produto.' }, { status: 400 });
    }

    const previa = await fetchPreviaAdicionarCor(company, produto);
    return NextResponse.json({ ...previa, podeGravar: autorizacao.auth.podeGravar });
  } catch (error) {
    console.error('[etiquetas/cores] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar o catálogo de cores.' },
      { status: 500 }
    );
  }
}
