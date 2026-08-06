import { NextResponse } from 'next/server';

import { autorizarEtiquetas, parseEtiquetaCompany } from '@/lib/auth/etiquetas-guard';
import { buscarSugestoesProduto } from '@/lib/repositories/etiquetas';

export const dynamic = 'force-dynamic';

/** Autocomplete do campo de produto (roda a cada tecla, então é leve). */
export async function GET(request: Request) {
  const autorizacao = await autorizarEtiquetas(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const url = new URL(request.url);
  const company = parseEtiquetaCompany(url.searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  const termo = (url.searchParams.get('q') ?? '').trim();
  if (termo.length < 2) return NextResponse.json({ sugestoes: [] });

  try {
    const sugestoes = await buscarSugestoesProduto(company, termo, {
      incluirInativos: url.searchParams.get('inativos') === '1',
    });
    return NextResponse.json({ sugestoes });
  } catch (error) {
    console.error('[etiquetas/sugestoes] erro', error);
    return NextResponse.json({ error: 'Erro ao buscar sugestões.' }, { status: 500 });
  }
}
