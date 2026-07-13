import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { getRegistro } from "@/lib/repositories/corporativoCadastros";
import { canApproveCadastro, normalizeRole } from "@/lib/auth/permissions";

export const maxDuration = 60;

/** Detalhe de um autocadastro (para a tela de aprovação). Restrito a aprovadores. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const username = request.headers.get("x-auth-username");
  const user = username ? await findUserByUsername(username) : null;
  if (!user || !canApproveCadastro(normalizeRole(user.role))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const data = await getRegistro(id);
    if (!data) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar autocadastro", error);
    return NextResponse.json({ error: "Erro ao carregar cadastro." }, { status: 500 });
  }
}
