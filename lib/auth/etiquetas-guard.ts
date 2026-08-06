import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole, normalizeRole, userHasPagePermission } from '@/lib/auth/permissions';
import type { RoleKey, UserSession } from '@/types/auth';
import type { EtiquetaCompany } from '@/lib/etiquetas/tipos';

/**
 * Imprimir etiqueta é operação de loja: não mostra custo nem altera cadastro, só
 * lê nome/subgrupo/cor/código de barra. Por isso o acesso NÃO é restrito por
 * função — vale a permissão de página normal, concedida no admin.
 *
 * A configuração do modelo (dimensões, fontes, impressora) é global da empresa,
 * então essa parte exige função de escrita: quem é somente-leitura imprime, mas
 * não muda o layout para todo mundo.
 */
export interface EtiquetaAuth {
  username: string;
  role: RoleKey;
  /** Pode salvar a configuração do modelo. */
  podeConfigurar: boolean;
}

export async function autorizarEtiquetas(
  request: Request,
  opts: { exigirConfiguracao?: boolean } = {}
): Promise<{ auth: EtiquetaAuth } | { erro: NextResponse }> {
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
  if (!userHasPagePermission(session, 'imprimir-etiquetas')) {
    return {
      erro: NextResponse.json(
        { error: 'Sem permissão para a tela de impressão de etiquetas.' },
        { status: 403 }
      ),
    };
  }

  const podeConfigurar = !isReadOnlyRole(role);
  if (opts.exigirConfiguracao && !podeConfigurar) {
    return {
      erro: NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode alterar o modelo da etiqueta.' },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeConfigurar } };
}

export function parseEtiquetaCompany(value: unknown): EtiquetaCompany | null {
  return value === 'nerd' || value === 'scarfme' ? value : null;
}
