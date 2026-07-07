import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import {
  listProdutoImagens,
  upsertProdutoImagem,
  deleteProdutoImagem,
} from "@/lib/repositories/corporativoStore";

export const maxDuration = 60;

async function isAdmin(request: Request): Promise<boolean> {
  const username = request.headers.get("x-auth-username");
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === "admin";
}

/**
 * Imagens de produto GLOBAIS do sistema (produto × cor × posição). São
 * compartilhadas — no futuro NERD/ScarfMe também leem daqui. Guardadas como
 * data-URL base64. Só admin gerencia por enquanto.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const produto = (searchParams.get("produto") ?? "").trim();
    if (!produto) return NextResponse.json({ error: "Produto é obrigatório." }, { status: 400 });
    const data = await listProdutoImagens(produto);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar imagens de produto", error);
    return NextResponse.json({ error: "Erro ao listar imagens." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const produto = String(body.produto ?? "").trim();
    const dataUrl = String(body.dataUrl ?? "");
    if (!produto || !dataUrl)
      return NextResponse.json({ error: "Produto e imagem são obrigatórios." }, { status: 400 });
    const item = await upsertProdutoImagem({
      produto,
      cor: body.cor != null ? String(body.cor) : "",
      posicao: body.posicao != null ? Number(body.posicao) : 0,
      dataUrl,
    });
    return NextResponse.json({ data: item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar imagem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const produto = (searchParams.get("produto") ?? "").trim();
    const cor = searchParams.get("cor") ?? "";
    const posicao = Number(searchParams.get("posicao") ?? 0);
    if (!produto) return NextResponse.json({ error: "Produto é obrigatório." }, { status: 400 });
    await deleteProdutoImagem(produto, cor, posicao);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover imagem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
