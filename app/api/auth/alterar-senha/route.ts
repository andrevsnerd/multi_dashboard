import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername, updateUser, verifyPassword } from "@/lib/auth/users-store";

export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const body = await request.json();
    const senhaAtual = String(body?.senhaAtual ?? "");
    const novaSenha = String(body?.novaSenha ?? "");

    if (!senhaAtual || !novaSenha) {
      return NextResponse.json(
        { error: "Preencha a senha atual e a nova senha" },
        { status: 400 }
      );
    }
    if (novaSenha.length < 6) {
      return NextResponse.json(
        { error: "A nova senha deve ter pelo menos 6 caracteres" },
        { status: 400 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    if (!verifyPassword(user.passwordHash, senhaAtual)) {
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
    }

    await updateUser(user.id, { password: novaSenha });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Alterar senha error:", e);
    return NextResponse.json({ error: "Erro ao alterar senha" }, { status: 500 });
  }
}
