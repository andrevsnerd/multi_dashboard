import { NextResponse } from 'next/server';

import { listarAjustesRecentes } from '@/lib/repositories/ajusteEstoque';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json({ recentes: [] });
    }
    // RESPONSAVEL gravado no Linx é o login do Linx, não o do dashboard — a busca
    // tem que usar a mesma resolução da escrita, senão o ajuste "desaparece" da lista.
    const recentes = await listarAjustesRecentes(await resolveResponsavelLinx(username));
    return NextResponse.json({ recentes });
  } catch (error) {
    console.error('[ajuste-estoque/recentes] erro', error);
    return NextResponse.json({ recentes: [] });
  }
}
