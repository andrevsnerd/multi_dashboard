import { NextResponse } from "next/server";

import { findUserByUsername } from "./users-store";
import { isReadOnlyRole } from "./permissions";

/**
 * Trava de somente-leitura para rotas de mutação de dados de empresa.
 *
 * Retorna um NextResponse 403 se o usuário identificado (via header `x-auth-username`)
 * for de uma função somente-leitura (diretor/supervisor). Caso contrário retorna null
 * e a rota segue normalmente.
 *
 * Uso típico no início do handler:
 *   const blocked = await readOnlyBlock(request.headers.get("x-auth-username"));
 *   if (blocked) return blocked;
 */
export async function readOnlyBlock(
  username: string | null | undefined
): Promise<NextResponse | null> {
  const normalized = username?.trim();
  if (!normalized) return null; // sem contexto de usuário — outras checagens da rota tratam

  const user = await findUserByUsername(normalized);
  if (user && isReadOnlyRole(user.role)) {
    return NextResponse.json(
      { error: "Acesso somente leitura: esta função não pode executar esta ação." },
      { status: 403 }
    );
  }
  return null;
}
