import { NextRequest, NextResponse } from "next/server";
import {
  updateUser,
  deleteUser,
  findUserById,
  findUserByUsername,
} from "@/lib/auth/users-store";
import type { RoleKey, PermissionKey } from "@/types/auth";

function isAdmin(username: string): boolean {
  const user = findUserByUsername(username);
  return user?.role === "admin";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = _request.headers.get("x-auth-username");
    if (!username || !isAdmin(username)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const user = findUserById(id);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
    });
  } catch (e) {
    console.error("Get user error:", e);
    return NextResponse.json(
      { error: "Erro ao buscar usuário" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !isAdmin(username)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const { username: newUsername, password, role, permissions } = body;
    const updates: {
      username?: string;
      password?: string;
      role?: RoleKey;
      permissions?: PermissionKey[];
    } = {};
    if (newUsername !== undefined) updates.username = String(newUsername).trim();
    if (password !== undefined) updates.password = String(password);
    if (role !== undefined) updates.role = role as RoleKey;
    if (permissions !== undefined) updates.permissions = permissions as PermissionKey[];
    const user = updateUser(id, updates);
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao atualizar usuário";
    const status = message.includes("não encontrado")
      ? 404
      : message.includes("já existe")
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !isAdmin(username)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const currentUser = findUserById(id);
    if (currentUser?.username === username) {
      return NextResponse.json(
        { error: "Não é possível remover seu próprio usuário" },
        { status: 400 }
      );
    }
    deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao remover usuário";
    const status = message.includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
