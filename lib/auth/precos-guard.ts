import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole, normalizeRole } from '@/lib/auth/permissions';
import type { RoleKey } from '@/types/auth';
import type { PrecoCompany } from '@/lib/repositories/precos';

/**
 * Quem pode sequer ABRIR a tela de custo/preço. Espelha `CUSTO_VISIBLE_ROLES`
 * (gerente e supervisor nunca veem custo). Diretor entra, mas é somente-leitura.
 */
export const PRECOS_VIEW_ROLES: RoleKey[] = ['admin', 'diretor', 'logistica'];

export interface PrecoAuth {
  username: string;
  role: RoleKey;
  podeExecutar: boolean;
}

/**
 * Resolve o usuário do header `x-auth-username` e devolve 401/403 quando ele não
 * pode ver custo. `exigirEscrita` também barra as funções somente-leitura.
 */
export async function autorizarPrecos(
  request: Request,
  opts: { exigirEscrita?: boolean } = {}
): Promise<{ auth: PrecoAuth } | { erro: NextResponse }> {
  const username = request.headers.get('x-auth-username')?.trim();
  if (!username) {
    return { erro: NextResponse.json({ error: 'Usuário não identificado. Faça login novamente.' }, { status: 401 }) };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 }) };
  }

  const role = normalizeRole(user.role);
  if (!PRECOS_VIEW_ROLES.includes(role)) {
    return {
      erro: NextResponse.json(
        { error: 'Esta função não tem acesso a informações de custo e preço.' },
        { status: 403 }
      ),
    };
  }

  const podeExecutar = !isReadOnlyRole(role);
  if (opts.exigirEscrita && !podeExecutar) {
    return {
      erro: NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode alterar custo ou preço.' },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeExecutar } };
}

export function parsePrecoCompany(value: unknown): PrecoCompany | null {
  return value === 'nerd' || value === 'scarfme' ? value : null;
}
