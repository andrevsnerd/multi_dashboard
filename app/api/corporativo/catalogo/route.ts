import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { canManageCatalogo } from "@/lib/auth/permissions";
import {
  listCatalogo,
  upsertCatalogoItem,
  deleteCatalogoItem,
} from "@/lib/repositories/corporativoStore";
import { fetchProdutosMeta } from "@/lib/repositories/corporativoProdutos";

export const maxDuration = 60;

/** Admin, diretor e supervisor podem administrar o catálogo da loja corporativa. */
async function canManage(request: Request): Promise<boolean> {
  const username = request.headers.get("x-auth-username");
  if (!username) return false;
  const user = await findUserByUsername(username);
  return canManageCatalogo(user?.role);
}

/** Lista o catálogo (admin). Reenriquece desc/EAN/grupo a partir do Linx. */
export async function GET() {
  try {
    const items = await listCatalogo();
    if (items.length === 0) return NextResponse.json({ data: [] });
    const meta = await fetchProdutosMeta(items.map((i) => i.produto)).catch(() => new Map());
    const data = items.map((i) => {
      const m = meta.get(i.produto);
      return {
        ...i,
        descProduto: m?.descProduto || i.descProduto,
        ean: m?.ean || i.ean,
        grupo: m?.grupo || i.grupo,
        linha: m?.linha ?? "",
        colecao: m?.colecao ?? "",
      };
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar catálogo corporativo", error);
    return NextResponse.json({ error: "Erro ao listar catálogo." }, { status: 500 });
  }
}

/** Adiciona/atualiza um produto no catálogo (admin, diretor, supervisor). */
export async function POST(request: Request) {
  if (!(await canManage(request)))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const produto = String(body.produto ?? "").trim();
    if (!produto) return NextResponse.json({ error: "Produto é obrigatório." }, { status: 400 });

    // Puxa desc/EAN/grupo do Linx no momento do cadastro (snapshot).
    const meta = (await fetchProdutosMeta([produto]).catch(() => new Map())).get(produto);

    const item = await upsertCatalogoItem({
      produto,
      precoAtacado: Number(body.precoAtacado ?? 0),
      categoria: body.categoria != null ? String(body.categoria) : undefined,
      ativo: body.ativo,
      ordem: body.ordem != null ? Number(body.ordem) : undefined,
      descProduto: body.descProduto ?? meta?.descProduto,
      ean: body.ean ?? meta?.ean,
      grupo: body.grupo ?? meta?.grupo,
    });
    return NextResponse.json({ data: item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar no catálogo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Remove um produto do catálogo (admin, diretor, supervisor). */
export async function DELETE(request: Request) {
  if (!(await canManage(request)))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const produto = searchParams.get("produto") ?? "";
    if (!produto) return NextResponse.json({ error: "Produto é obrigatório." }, { status: 400 });
    await deleteCatalogoItem(produto);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
