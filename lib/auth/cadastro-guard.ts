import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole, normalizeRole } from '@/lib/auth/permissions';
import type { RoleKey } from '@/types/auth';
import type { CadastroCompany } from '@/lib/repositories/cadastro';

/**
 * Quem pode abrir as telas de cadastro. A tela não mostra custo, mas renomear um
 * grupo é um ato ESTRUTURAL: cascateia para milhares de produtos e desalinha as
 * regras do dashboard que casam por nome. Por isso o acesso é o mesmo conjunto
 * restrito do Alterar Custo / Preço, em vez do conjunto largo das telas de leitura.
 *
 * Diretor entra e confere, mas é somente-leitura (READ_ONLY_ROLES).
 */
export const CADASTRO_VIEW_ROLES: RoleKey[] = ['admin', 'diretor', 'logistica'];

export interface CadastroAuth {
  username: string;
  role: RoleKey;
  podeExecutar: boolean;
}

/**
 * Resolve o usuário do header `x-auth-username` e devolve 401/403 quando ele não
 * pode mexer no cadastro. `exigirEscrita` também barra as funções somente-leitura.
 */
export async function autorizarCadastro(
  request: Request,
  opts: { exigirEscrita?: boolean } = {}
): Promise<{ auth: CadastroAuth } | { erro: NextResponse }> {
  const username = request.headers.get('x-auth-username')?.trim();
  if (!username) {
    return {
      erro: NextResponse.json({ error: 'Usuário não identificado. Faça login novamente.' }, { status: 401 }),
    };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 }) };
  }

  const role = normalizeRole(user.role);
  if (!CADASTRO_VIEW_ROLES.includes(role)) {
    return {
      erro: NextResponse.json(
        { error: 'Esta função não tem acesso à alteração de cadastro.' },
        { status: 403 }
      ),
    };
  }

  const podeExecutar = !isReadOnlyRole(role);
  if (opts.exigirEscrita && !podeExecutar) {
    return {
      erro: NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode alterar o cadastro.' },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeExecutar } };
}

export function parseCadastroCompany(value: unknown): CadastroCompany | null {
  return value === 'nerd' || value === 'scarfme' ? value : null;
}
