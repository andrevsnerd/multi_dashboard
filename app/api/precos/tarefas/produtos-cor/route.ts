import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { fetchPrecosCor } from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Modo "preço por cor": cada código de barras vira um item produto × cor, com o preço que o
 * PDV vê em cada tabela. Mesmo formato de /api/precos/produtos para a tela reaproveitar a grade.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; codigos?: string[] };
    if (!parsePrecoCompany(body.company)) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    const codigos = Array.isArray(body.codigos) ? body.codigos.map((c) => String(c ?? '').trim()).filter(Boolean) : [];
    if (codigos.length === 0) {
      return NextResponse.json({ error: 'Cole pelo menos um código de barras.' }, { status: 400 });
    }
    return NextResponse.json(await fetchPrecosCor(codigos));
  } catch (error) {
    console.error('[precos/tarefas/produtos-cor] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar os itens por cor.' },
      { status: 500 }
    );
  }
}
