import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { normalizeRole, userHasPagePermission } from "@/lib/auth/permissions";
import type { RoleKey, UserSession } from "@/types/auth";

/**
 * Guarda do Controle Financeiro.
 *
 * Ler exige a página liberada (folha, fornecedor, impostos e resultado da empresa).
 * IMPORTAR uma planilha nova substitui a base inteira, então fica com o admin e a função
 * financeiro (quem mantém a planilha) — os demais com a página marcada só consultam.
 * É exceção ao somente-leitura da função financeiro, que vale no resto do sistema.
 */
export const FINANCEIRO_IMPORT_ROLES: RoleKey[] = ["admin", "financeiro"];

export interface FinanceiroAuth {
  username: string;
  role: RoleKey;
  podeImportar: boolean;
}

export async function autorizarFinanceiro(
  request: Request,
  opts: { exigirImportacao?: boolean } = {}
): Promise<{ auth: FinanceiroAuth } | { erro: NextResponse }> {
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
  if (!userHasPagePermission(session, "controle-financeiro")) {
    return {
      erro: NextResponse.json({ error: "Sem permissão para o Controle Financeiro." }, { status: 403 }),
    };
  }

  const podeImportar = FINANCEIRO_IMPORT_ROLES.includes(role);
  if (opts.exigirImportacao && !podeImportar) {
    return {
      erro: NextResponse.json({ error: "Só o administrador pode importar a planilha." }, { status: 403 }),
    };
  }

  return { auth: { username, role, podeImportar } };
}
