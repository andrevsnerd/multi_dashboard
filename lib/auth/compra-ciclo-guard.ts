import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, normalizeRole, userHasPagePermission } from "@/lib/auth/permissions";
import type { RoleKey, UserSession } from "@/types/auth";

/**
 * Guarda da tela de Ciclo de Compra.
 *
 * Ler os prazos é inofensivo (é a explicação da coluna Compra Ideal), mas GRAVAR muda o
 * cálculo de reposição da rede inteira — quantidade sugerida e data de compra de toda loja.
 * Por isso a escrita exige função de escrita: quem é somente-leitura (diretor, supervisor)
 * abre a tela e confere os números, mas não altera.
 */
export interface CompraCicloAuth {
  username: string;
  role: RoleKey;
  /** Pode salvar config e presets. */
  podeEditar: boolean;
}

export type CompraCicloCompany = "nerd" | "scarfme";

export function parseCompraCicloCompany(value: unknown): CompraCicloCompany | null {
  return value === "nerd" || value === "scarfme" ? value : null;
}

export async function autorizarCompraCiclo(
  request: Request,
  opts: { exigirEdicao?: boolean } = {}
): Promise<{ auth: CompraCicloAuth } | { erro: NextResponse }> {
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
  if (!userHasPagePermission(session, "compra-ciclo")) {
    return {
      erro: NextResponse.json(
        { error: "Sem permissão para a tela de Ciclo de Compra." },
        { status: 403 }
      ),
    };
  }

  const podeEditar = !isReadOnlyRole(role);
  if (opts.exigirEdicao && !podeEditar) {
    return {
      erro: NextResponse.json(
        { error: "Acesso somente leitura: esta função não pode alterar os prazos de compra." },
        { status: 403 }
      ),
    };
  }

  return { auth: { username, role, podeEditar } };
}
