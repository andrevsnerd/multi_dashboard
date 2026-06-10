import { NextRequest, NextResponse } from "next/server";
import { authenticate, seedInitialUsersIfEmpty } from "@/lib/auth/users-store";
import type { UserSession } from "@/types/auth";

export async function POST(request: NextRequest) {
  try {
    await seedInitialUsersIfEmpty();
    const body = await request.json();
    const { username, password } = body;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Usuário e senha são obrigatórios" },
        { status: 400 }
      );
    }
    const user = await authenticate(String(username).trim(), String(password));
    if (!user) {
      return NextResponse.json(
        { error: "Usuário ou senha inválidos" },
        { status: 401 }
      );
    }
    const session: UserSession = {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      allowedCompanies: user.allowedCompanies,
      nomeExibicao: user.nomeExibicao,
      somenteVarejo: user.somenteVarejo,
    };
    return NextResponse.json({ user: session });
  } catch (e) {
    console.error("Login error:", e);
    return NextResponse.json(
      { error: "Erro ao fazer login" },
      { status: 500 }
    );
  }
}
