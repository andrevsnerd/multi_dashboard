import { NextResponse } from "next/server";

import { getControleEstoqueItemMetricas } from "@/lib/server/controle-estoque-metricas";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial") || null;
  const produto = searchParams.get("produto") || "";
  const corProduto = searchParams.get("corProduto");
  const includeHistoricoRows = searchParams.get("includeHistorico") === "true";

  if (!produto.trim()) {
    return NextResponse.json({ error: "Parametro produto e obrigatorio" }, { status: 400 });
  }

  try {
    const metricas = await getControleEstoqueItemMetricas({
      company,
      filial,
      includeHistorico: includeHistoricoRows,
      item: {
        produto,
        corProduto: corProduto != null ? corProduto : null,
      },
    });

    return NextResponse.json({ data: metricas.vendasPorFilial });
  } catch (error) {
    console.error("Erro ao carregar vendas por filial do item", error);
    return NextResponse.json(
      { error: "Erro ao carregar vendas por filial do item" },
      { status: 500 }
    );
  }
}
