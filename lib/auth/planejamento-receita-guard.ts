import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { normalizeRole, userHasPagePermission } from "@/lib/auth/permissions";
import type { RoleKey, UserSession } from "@/types/auth";

/**
 * Guarda do Planejamento de Receita.
 *
 * Ler exige a página liberada (o orçado é a meta da empresa). EDITAR o orçado é mais
 * restrito que qualquer operação de loja: muda a régua de atingimento da rede inteira,
 * então fica só com as funções abaixo — mesmo quem tem a página marcada não edita.
 */
export const PLANEJAMENTO_EDITOR_ROLES: RoleKey[] = ["admin"];

export interface PlanejamentoAuth {
  username: string;
  role: RoleKey;
  podeEditar: boolean;
}

export async function autorizarPlanejamento(
  request: Request,
  opts: { exigirEdicao?: boolean } = {}
): Promise<{ auth: PlanejamentoAuth } | { erro: NextResponse }> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) {
    return {
      erro: NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 }),
    };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: "Usuário não encontrado." }, { status: 403 }) };
  }

  const role = normalizeRole(user.role);
  const session = { ...user, role } as unknown as UserSession;
  if (!userHasPagePermission(session, "planejamento-receita")) {
    return {
      erro: NextResponse.json({ error: "Sem permissão para o Planejamento de Receita." }, { status: 403 }),
    };
  }

  const podeEditar = PLANEJAMENTO_EDITOR_ROLES.includes(role);
  if (opts.exigirEdicao && !podeEditar) {
    return {
      erro: NextResponse.json(
        { error: "Só o administrador pode alterar o orçado." },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeEditar } };
}
