import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste, AjustePayload } from '@/lib/repositories/ajuste-historico';

async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * POST /api/admin/ajuste-historico
 * Cria um registro de ajuste manual no histórico (NERD_AJUSTE_HISTORICO).
 * Não altera o estoque — apenas registra para fins de auditoria/extrato.
 * Permitido apenas para admins.
 *
 * Body:
 *   filial: string
 *   itens: Array<{ produto: string; cor: string; qtde: number }>
 *   romaneioRef?: string   — romaneio que originou o ajuste
 *   tipoAjuste?: string    — ex: 'EDICAO_ROMANEIO_SAIDA', 'AJUSTE_MANUAL'
 *   responsavel?: string
 *   obs?: string
 */
export async function POST(request: NextRequest) {
  const username = request.headers.get('x-auth-username')?.trim() ?? null;
  if (!await isAdmin(username)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: AjustePayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 });
  }

  const { filial, itens } = body;

  if (!filial || !Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json(
      { error: 'Parâmetros obrigatórios: filial, itens (array não-vazio).' },
      { status: 400 }
    );
  }

  for (const item of itens) {
    if (!item.produto || item.qtde == null || item.qtde === 0) {
      return NextResponse.json(
        { error: 'Cada item precisa de produto e qtde (≠0).' },
        { status: 400 }
      );
    }
  }

  try {
    await inserirAjuste({
      filial,
      itens,
      romaneioRef: body.romaneioRef,
      tipoAjuste: body.tipoAjuste ?? 'AJUSTE_MANUAL',
      responsavel: body.responsavel ?? username ?? undefined,
      obs: body.obs,
    });
    return NextResponse.json({ success: true, inseridos: itens.length });
  } catch (error) {
    console.error('Erro ao inserir ajuste histórico:', error);
    return NextResponse.json({ error: 'Erro ao registrar ajuste.' }, { status: 500 });
  }
}
