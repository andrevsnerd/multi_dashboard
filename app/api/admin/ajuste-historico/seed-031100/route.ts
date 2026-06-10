import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste, ensureAjusteTableExists } from '@/lib/repositories/ajuste-historico';
import { query } from '@/lib/db/connection';

async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * GET /api/admin/ajuste-historico/seed-031100
 * Insere (ou corrige) os registros de auditoria retroativos do romaneio 031100:
 *
 *   049769 / 06 (PRETO)  —  saída foi de 1 → 2  (qtde_ajuste = -1 em CENTER NORTE)
 *   038020 / 06 (PRETO)  —  saída foi de 2 → 1  (qtde_ajuste = +1 em CENTER NORTE)
 *
 * Idempotente: limpa registros anteriores deste romaneio e reinicia.
 */
export async function GET(request: NextRequest) {
  const username = request.headers.get('x-auth-username')?.trim() ?? null;
  if (!await isAdmin(username)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  await ensureAjusteTableExists();

  // Limpa qualquer registro anterior (inclusive os inseridos com cor errada)
  await query(`DELETE FROM NERD_AJUSTE_HISTORICO WHERE ROMANEIO_REF = '031100'`);

  const obs = 'Ajuste retroativo: edição de qtd no romaneio 031100 em 2026-06-10';
  const itens = [
    { produto: '049769', cor: '06', qtde: -1 }, // saída 1→2: 1 a mais saiu de CENTER NORTE
    { produto: '038020', cor: '06', qtde: 1 },  // saída 2→1: 1 retornou p/ CENTER NORTE
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
    message: '2 registros de ajuste inseridos para romaneio 031100 com cor 06.',
    itens,
  });
}
