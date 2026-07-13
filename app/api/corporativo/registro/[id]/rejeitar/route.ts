import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { getRegistro, rejeitarRegistro } from "@/lib/repositories/corporativoCadastros";
import { canApproveCadastro, normalizeRole } from "@/lib/auth/permissions";

export const maxDuration = 60;

/** Rejeita um autocadastro. O usuário do sistema continua existindo (só não compra). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const username = request.headers.get("x-auth-username");
  const approver = username ? await findUserByUsername(username) : null;
  if (!approver || !canApproveCadastro(normalizeRole(approver.role))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const registro = await getRegistro(id);
  if (!registro) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });

  let motivo = "";
  try {
    const body = (await request.json()) as { motivo?: string } | null;
    motivo = String(body?.motivo ?? "").trim();
  } catch {
    // motivo opcional
  }

  try {
    await rejeitarRegistro(id, { revisadoPor: approver.username, motivo });
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error("Erro ao rejeitar autocadastro", error);
    return NextResponse.json({ error: "Erro ao rejeitar cadastro." }, { status: 500 });
  }
}
