import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import {
  CUSTO_VISIBLE_ROLES,
  isReadOnlyRole,
  normalizeRole,
  userHasPagePermission,
} from "@/lib/auth/permissions";
import type { RoleKey, UserSession } from "@/types/auth";

/**
 * Guarda da tela Aproveitamentos Matriz.
 *
 * Abrir exige a permissão da página. Salvar exige função de escrita (diretor e supervisor
 * só conferem). O custo só sai do servidor para CUSTO_VISIBLE_ROLES — quem não vê custo
 * recebe a tela sem ele, nunca escondido só no navegador.
 */
export interface AproveitamentosAuth {
  username: string;
  role: RoleKey;
  podeEditar: boolean;
  podeVerCusto: boolean;
}

export async function autorizarAproveitamentos(
  request: Request,
  opts: { exigirEdicao?: boolean } = {}
): Promise<{ auth: AproveitamentosAuth } | { erro: NextResponse }> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) {
    return {
      erro: NextResponse.json(
        { error: "Usuário não identificado. Faça login novamente." },
        { status: 401 }
      ),
    };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: "Usuário não encontrado." }, { status: 403 }) };
  }

  const role = normalizeRole(user.role);
  const session = { ...user, role } as unknown as UserSession;
  if (!userHasPagePermission(session, "aproveitamentos-matriz")) {
    return {
      erro: NextResponse.json(
        { error: "Sem permissão para a tela Aproveitamentos Matriz." },
        { status: 403 }
      ),
    };
  }

  const podeEditar = !isReadOnlyRole(role);
  if (opts.exigirEdicao && !podeEditar) {
    return {
      erro: NextResponse.json(
        { error: "Acesso somente leitura: esta função não pode alterar o estoque de aproveitamentos." },
        { status: 403 }
      ),
    };
  }

  return {
    auth: { username, role, podeEditar, podeVerCusto: CUSTO_VISIBLE_ROLES.includes(role) },
  };
}
