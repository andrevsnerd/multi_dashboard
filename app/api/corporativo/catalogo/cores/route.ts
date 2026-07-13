import { NextResponse } from "next/server";

import { fetchProductAvailableColors } from "@/lib/repositories/productDetail";

export const maxDuration = 60;

/**
 * Cores cadastradas de um produto (código + nome), para o admin do catálogo
 * selecionar a cor de uma imagem sem precisar digitar o código. Reusa a mesma
 * fonte da loja (cadastro do produto vence, mapa global só fallback).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const produto = (searchParams.get("produto") ?? "").trim();
    if (!produto) return NextResponse.json({ error: "Produto é obrigatório." }, { status: 400 });
    const cores = await fetchProductAvailableColors(produto);
    const data = cores
      .filter((c) => c.code) // ignora "sem cor" — a imagem geral usa cor vazia
      .map((c) => ({ code: c.code, description: c.description, displayName: c.displayName }));
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar cores do produto (catálogo)", error);
    return NextResponse.json({ error: "Erro ao listar cores." }, { status: 500 });
  }
}
