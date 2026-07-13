import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { canManageCatalogo } from "@/lib/auth/permissions";
import { buscarProdutos } from "@/lib/repositories/corporativoProdutos";

export const maxDuration = 60;

/** Busca produtos no Linx para admin/diretor/supervisor escolherem e incluírem no catálogo. */
export async function GET(request: Request) {
  const username = request.headers.get("x-auth-username");
  const user = username ? await findUserByUsername(username) : null;
  if (!canManageCatalogo(user?.role))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const term = searchParams.get("term") ?? "";
  try {
    const data = await buscarProdutos(term, 40);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao buscar produtos (catálogo)", error);
    return NextResponse.json({ error: "Erro ao buscar produtos." }, { status: 500 });
  }
}
