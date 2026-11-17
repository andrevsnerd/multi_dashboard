import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import {
  canAccessCompany,
  hasFullPageAccess,
  isReadOnlyRole,
  normalizeRole,
  roleAllowsPermission,
} from "@/lib/auth/permissions";
import { isEmpresaFat, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { RoleKey, UserSession } from "@/types/auth";

const PERMISSAO = "faturamento-ecommerce";

export interface FatAuth {
  username: string;
  role: RoleKey;
  empresa: EmpresaFat;
  podeGravar: boolean;
}

/**
 * Faturamento E-commerce: confere usuário (header x-auth-username), permissão da
 * página, acesso à empresa e — quando `escrita` — se a função pode gravar no Linx.
 * NERD e Scarf Me são checadas separadamente: quem só vê uma empresa não fatura a outra.
 */
export async function autorizarFaturamentoEcommerce(
  request: Request,
  empresaRaw: unknown,
  opts: { escrita?: boolean } = {}
): Promise<{ auth: FatAuth } | { erro: NextResponse }> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) {
    return { erro: NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 }) };
  }
  if (!isEmpresaFat(empresaRaw)) {
    return { erro: NextResponse.json({ error: "Empresa inválida (use nerd ou scarfme)." }, { status: 400 }) };
  }
  const user = await findUserByUsername(username);
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado." }, { status: 403 }) };

  const role = normalizeRole(user.role);
  const sessao = { ...user, role } as unknown as UserSession;
  const temPagina =
    roleAllowsPermission(role, PERMISSAO) &&
    (hasFullPageAccess(role) || (user.permissions ?? []).includes(PERMISSAO as never));
  if (!temPagina) {
    return { erro: NextResponse.json({ error: "Sem permissão para o Faturamento E-commerce." }, { status: 403 }) };
  }
  if (!canAccessCompany(sessao, empresaRaw)) {
    return { erro: NextResponse.json({ error: "Sem acesso a esta empresa." }, { status: 403 }) };
  }
  const podeGravar = !isReadOnlyRole(role);
  if (opts.escrita && !podeGravar) {
    return { erro: NextResponse.json({ error: "Acesso somente leitura: esta função não grava no Linx." }, { status: 403 }) };
  }
  return { auth: { username, role, empresa: empresaRaw, podeGravar } };
}

export function erroJson(err: unknown, status = 500) {
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg }, { status });
}
