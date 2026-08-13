import { NextResponse } from "next/server";

import { fetchEstoqueProdutoPorFilialPorTamanho } from "@/lib/repositories/controleEstoque";

/**
 * Estoque por filial × tamanho de um item — base da distribuição por tamanho na compra
 * salva. Produto que não é de grade fashion volta com `tamanhos: []`, e o chamador segue
 * com a distribuição agregada de sempre.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const produto = (searchParams.get("produto") ?? "").trim();

  if (!produto) {
    return NextResponse.json({ error: "Parâmetro 'produto' é obrigatório" }, { status: 400 });
  }

  try {
    const data = await fetchEstoqueProdutoPorFilialPorTamanho({
      company: searchParams.get("company") ?? undefined,
      filial: searchParams.get("filial") || null,
      produto,
      corProduto: searchParams.get("corProduto"),
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar estoque por tamanho do item", error);
    return NextResponse.json(
      { error: "Erro ao carregar estoque por tamanho do item" },
      { status: 500 }
    );
  }
}
