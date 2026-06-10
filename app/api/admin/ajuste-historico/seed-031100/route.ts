import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste, ensureAjusteTableExists, queryAjustesHistorico } from '@/lib/repositories/ajuste-historico';

async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * GET /api/admin/ajuste-historico/seed-031100
 * Insere os registros de auditoria retroativos do romaneio 031100 que foram
 * ajustados sem registro de histórico em 2026-06-10:
 *
 *   049769 / PRETO  —  saída foi de 1 → 2  (qtde_ajuste = -1 em CENTER NORTE)
 *   038020 / PRETO  —  saída foi de 2 → 1  (qtde_ajuste = +1 em CENTER NORTE)
 *
 * Idempotente: verifica se os registros já existem antes de inserir.
 */
export async function GET(request: NextRequest) {
  const username = request.headers.get('x-auth-username')?.trim() ?? null;
  if (!await isAdmin(username)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  await ensureAjusteTableExists();

  // Verifica se já foram inseridos
  const jaExistem049 = await queryAjustesHistorico('049769', 'PRETO', 'CENTER NORTE');
  const jaExistem038 = await queryAjustesHistorico('038020', 'PRETO', 'CENTER NORTE');

  const j049 = jaExistem049.filter(r => r.ROMANEIO_REF === '031100');
  const j038 = jaExistem038.filter(r => r.ROMANEIO_REF === '031100');

  if (j049.length > 0 && j038.length > 0) {
    return NextResponse.json({
      success: true,
      status: 'já_inseridos',
      message: 'Registros do romaneio 031100 já existem no histórico.',
      registros: [...j049, ...j038],
    });
  }

  const obs = 'Ajuste retroativo: edição de qtd no romaneio 031100 em 2026-06-10';

  const itens = [
    ...(j049.length === 0 ? [{ produto: '049769', cor: 'PRETO', qtde: -1 }] : []),
    ...(j038.length === 0 ? [{ produto: '038020', cor: 'PRETO', qtde: 1 }] : []),
  ];

  await inserirAjuste({
    filial: 'NERD CENTER NORTE',
    itens,
    romaneioRef: '031100',
    tipoAjuste: 'EDICAO_ROMANEIO_SAIDA',
    responsavel: username ?? 'admin',
    obs,
  });

  return NextResponse.json({
    success: true,
    status: 'inseridos',
    message: `${itens.length} registro(s) de ajuste inseridos para romaneio 031100.`,
    itens,
  });
}
