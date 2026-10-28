import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { seesTodosAjustesRecentes } from '@/lib/auth/permissions';
import { AJUSTES_RECENTES_POR_PAGINA, listarAjustesRecentes } from '@/lib/repositories/ajusteEstoque';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';

export const dynamic = 'force-dynamic';

/** ?busca= (nome do ajuste, filial ou responsável) e ?pagina= (1-based, 30 por página). */
export async function GET(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json({ recentes: [], total: 0 });
    }
    const { searchParams } = new URL(request.url);
    const busca = searchParams.get('busca')?.trim() ?? '';
    const pagina = Math.max(1, Number(searchParams.get('pagina')) || 1);
    const porPagina = AJUSTES_RECENTES_POR_PAGINA;

    // RESPONSAVEL gravado no Linx é o login do Linx, não o do dashboard — a busca
    // tem que usar a mesma resolução da escrita, senão o ajuste "desaparece" da lista.
    const responsavel = await resolveResponsavelLinx(username);
    // Logística acompanha os ajustes de todos; `responsavel` diz à tela quais são dela
    // (só esses podem ser desfeitos).
    const user = await findUserByUsername(username);
    const todos = !!user && seesTodosAjustesRecentes(user.role);
    const { recentes, total } = await listarAjustesRecentes(todos ? null : responsavel, {
      busca,
      pagina,
      porPagina,
    });
    return NextResponse.json({
      recentes,
      total,
      pagina,
      porPagina,
      ...(todos ? { todos: true, responsavel } : {}),
    });
  } catch (error) {
    console.error('[ajuste-estoque/recentes] erro', error);
    return NextResponse.json({ recentes: [], total: 0 });
  }
}
