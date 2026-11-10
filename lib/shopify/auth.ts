import "server-only";

import { NextResponse } from "next/server";

import { isReadOnlyRole, normalizeRole, userHasPagePermission } from "@/lib/auth/permissions";
import { findUserByUsername } from "@/lib/auth/users-store";
import type { RoleKey, UserSession } from "@/types/auth";

/**
 * Acesso ao mapeamento Shopify ↔ Linx: vale a permissão da página "shopify" (admin).
 * Gravar vínculo exige função de escrita (somente-leitura só consulta).
 */
export interface ShopifyAuth {
  username: string;
  role: RoleKey;
  podeEditar: boolean;
}

export async function autorizarShopify(
  request: Request,
  opts: { exigirEscrita?: boolean; somenteAdmin?: boolean } = {},
): Promise<{ auth: ShopifyAuth } | { erro: NextResponse }> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) {
    return { erro: NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 }) };
  }
  const user = await findUserByUsername(username);
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado." }, { status: 403 }) };

  const role = normalizeRole(user.role);
  const session = { ...user, role } as unknown as UserSession;
  if (!userHasPagePermission(session, "shopify")) {
    return { erro: NextResponse.json({ error: "Sem permissão para a página Shopify." }, { status: 403 }) };
  }
  // Mapeamento Shopify ↔ Linx: só admin (pedido do dono, 10/11/2026).
  if (opts.somenteAdmin && role !== "admin") {
    return { erro: NextResponse.json({ error: "O mapeamento Shopify ↔ Linx é restrito ao admin." }, { status: 403 }) };
  }
  const podeEditar = !isReadOnlyRole(role);
  if (opts.exigirEscrita && !podeEditar) {
    return {
      erro: NextResponse.json({ error: "Acesso somente leitura: esta função não pode alterar o mapeamento." }, { status: 403 }),
    };
  }
  return { auth: { username, role, podeEditar } };
}
