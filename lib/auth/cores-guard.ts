import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole, normalizeRole, userHasPagePermission } from '@/lib/auth/permissions';
import { PRECOS_VIEW_ROLES } from '@/lib/auth/precos-guard';
import type { RoleKey, UserSession } from '@/types/auth';
import type { CorCompany } from '@/lib/repositories/produtoCores';

/**
 * Adicionar cor ao cadastro do produto — MESMA autorização de Alterar Custo /
 * Preço (`PRECOS_VIEW_ROLES`: admin, diretor, logística). Decisão do dono: é ato
 * de cadastro, não de loja, então não basta ter a tela de etiquetas.
 *
 * Diretor abre e confere, mas não grava (é somente-leitura no resto do sistema),
 * exatamente como na ficha de custo/preço.
 */
export interface CorAuth {
  username: string;
  role: RoleKey;
  podeGravar: boolean;
}

export async function autorizarCores(
  request: Request,
  opts: { exigirEscrita?: boolean } = {}
): Promise<{ auth: CorAuth } | { erro: NextResponse }> {
  const username = request.headers.get('x-auth-username')?.trim();
  if (!username) {
    return {
      erro: NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      ),
    };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 }) };
  }

  const role = normalizeRole(user.role);
  const session = { ...user, role } as unknown as UserSession;

  // O botão vive dentro da tela de etiquetas: sem ela, não há por que responder.
  if (!userHasPagePermission(session, 'imprimir-etiquetas')) {
    return {
      erro: NextResponse.json(
        { error: 'Sem permissão para a tela de impressão de etiquetas.' },
        { status: 403 }
      ),
    };
  }

  if (!PRECOS_VIEW_ROLES.includes(role)) {
    return {
      erro: NextResponse.json(
        { error: 'Esta função não pode alterar o cadastro de cores do produto.' },
        { status: 403 }
      ),
    };
  }

  const podeGravar = !isReadOnlyRole(role);
  if (opts.exigirEscrita && !podeGravar) {
    return {
      erro: NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode criar cor no cadastro.' },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeGravar } };
}

export function parseCorCompany(value: unknown): CorCompany | null {
  return value === 'nerd' || value === 'scarfme' ? value : null;
}
