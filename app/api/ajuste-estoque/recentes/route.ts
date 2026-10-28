import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { seesTodosAjustesRecentes } from '@/lib/auth/permissions';
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
    const responsavel = await resolveResponsavelLinx(username);
    // Logística acompanha os ajustes de todos; `responsavel` diz à tela quais são dela
    // (só esses podem ser desfeitos).
    const user = await findUserByUsername(username);
    if (user && seesTodosAjustesRecentes(user.role)) {
      return NextResponse.json({ recentes: await listarAjustesRecentes(null), todos: true, responsavel });
    }
    const recentes = await listarAjustesRecentes(responsavel);
    return NextResponse.json({ recentes });
  } catch (error) {
    console.error('[ajuste-estoque/recentes] erro', error);
    return NextResponse.json({ recentes: [] });
  }
}
