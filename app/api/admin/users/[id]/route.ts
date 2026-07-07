import { NextRequest, NextResponse } from "next/server";
import {
  updateUser,
  deleteUser,
  findUserById,
  findUserByUsername,
} from "@/lib/auth/users-store";
import type { CompanyKey, RoleKey, PermissionKey } from "@/types/auth";

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === "admin";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = _request.headers.get("x-auth-username");
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const user = await findUserById(id);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      allowedCompanies: user.allowedCompanies ?? undefined,
      nomeExibicao: user.nomeExibicao ?? undefined,
      somenteVarejo: user.somenteVarejo ?? undefined,
      clienteCodigo: user.clienteCodigo ?? undefined,
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
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const { username: newUsername, password, role, permissions, allowedCompanies, nomeExibicao, somenteVarejo, clienteCodigo } = body;
    const updates: {
      username?: string;
      password?: string;
      role?: RoleKey;
      permissions?: PermissionKey[];
      allowedCompanies?: CompanyKey[] | null;
      nomeExibicao?: string | null;
      somenteVarejo?: boolean | null;
      clienteCodigo?: string | null;
    } = {};
    if (newUsername !== undefined) updates.username = String(newUsername).trim();
    if (password !== undefined) updates.password = String(password);
    if (role !== undefined) updates.role = role as RoleKey;
    if (permissions !== undefined) updates.permissions = permissions as PermissionKey[];
    if (allowedCompanies !== undefined) {
      updates.allowedCompanies =
        Array.isArray(allowedCompanies) && allowedCompanies.length > 0
          ? (allowedCompanies as CompanyKey[])
          : null;
    }
    if (nomeExibicao !== undefined) {
      updates.nomeExibicao = nomeExibicao ? String(nomeExibicao).trim() : null;
    }
    if (somenteVarejo !== undefined) {
      updates.somenteVarejo = somenteVarejo === true ? true : null;
    }
    if (clienteCodigo !== undefined) {
      updates.clienteCodigo = clienteCodigo ? String(clienteCodigo).trim() : null;
    }
    const user = await updateUser(id, updates);
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      allowedCompanies: user.allowedCompanies ?? undefined,
      nomeExibicao: user.nomeExibicao ?? undefined,
      somenteVarejo: user.somenteVarejo ?? undefined,
      clienteCodigo: user.clienteCodigo ?? undefined,
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
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const currentUser = await findUserById(id);
    if (currentUser?.username === username) {
      return NextResponse.json(
        { error: "Não é possível remover seu próprio usuário" },
        { status: 400 }
      );
    }
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao remover usuário";
    const status = message.includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
