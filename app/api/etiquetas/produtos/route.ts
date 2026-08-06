import { NextResponse } from 'next/server';

import { autorizarEtiquetas, parseEtiquetaCompany } from '@/lib/auth/etiquetas-guard';
import { buscarProdutosParaEtiqueta } from '@/lib/repositories/etiquetas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  company?: string;
  termo?: string;
  limite?: number;
  incluirInativos?: boolean;
  todoCadastro?: boolean;
}

/** Busca produtos (com todas as cores e códigos de barra) para montar etiquetas. */
export async function POST(request: Request) {
  const autorizacao = await autorizarEtiquetas(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseEtiquetaCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }

    const termo = (body.termo ?? '').trim();
    if (termo.length < 2) {
      return NextResponse.json(
        { error: 'Digite ao menos 2 caracteres (código, nome ou código de barra).' },
        { status: 400 }
      );
    }

    const produtos = await buscarProdutosParaEtiqueta(company, termo, {
      limite: typeof body.limite === 'number' ? body.limite : undefined,
      incluirInativos: Boolean(body.incluirInativos),
      todoCadastro: Boolean(body.todoCadastro),
    });

    return NextResponse.json({ produtos });
  } catch (error) {
    console.error('[etiquetas/produtos] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar produtos.' },
      { status: 500 }
    );
  }
}
