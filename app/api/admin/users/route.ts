import { NextRequest, NextResponse } from "next/server";
import {
  listUsers,
  createUser,
  seedInitialUsersIfEmpty,
  findUserByUsername,
} from "@/lib/auth/users-store";
import type { CompanyKey, RoleKey, PermissionKey } from "@/types/auth";

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    await seedInitialUsersIfEmpty();
    const allUsers = await listUsers();
    const users = allUsers.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      permissions: u.permissions,
      allowedCompanies: u.allowedCompanies ?? undefined,
    }));
    return NextResponse.json(users);
  } catch (e) {
    console.error("List users error:", e);
    return NextResponse.json(
      { error: "Erro ao listar usuários" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    await seedInitialUsersIfEmpty();
    const body = await request.json();
    const { username: newUsername, password, role, permissions, allowedCompanies } = body;
    if (!newUsername || !password || !role) {
      return NextResponse.json(
        { error: "Usuário, senha e função são obrigatórios" },
        { status: 400 }
      );
    }
    const user = await createUser(
      String(newUsername).trim(),
      String(password),
      role as RoleKey,
      (permissions ?? []) as PermissionKey[],
      Array.isArray(allowedCompanies) && allowedCompanies.length > 0
        ? (allowedCompanies as CompanyKey[])
        : undefined
    );
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      allowedCompanies: user.allowedCompanies ?? undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao criar usuário";
    const status = message.includes("já existe") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
