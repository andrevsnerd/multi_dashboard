import { NextResponse } from "next/server";

import { fetchClassificacaoMetragemPorProdutos } from "@/lib/repositories/controleEstoque";

/**
 * Subgrupo do cadastro (PRODUTOS.SUBGRUPO_PRODUTO) dos produtos pedidos. Vem do
 * cadastro e não da lista sugerida, então todo item da compra salva tem o seu.
 *
 * POST { produtos: string[] } → { data: Record<produto, { subgrupo }> }
 */
const LOTE = 1000; // SQL Server aceita até 2100 parâmetros por query

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { produtos?: unknown };
    const produtos = Array.isArray(body?.produtos)
      ? [...new Set(body.produtos.map((p) => String(p ?? "").trim()).filter(Boolean))]
      : [];

    const data: Record<string, { subgrupo: string }> = {};
    for (let i = 0; i < produtos.length; i += LOTE) {
      const cadastro = await fetchClassificacaoMetragemPorProdutos(produtos.slice(i, i + LOTE));
      for (const [produto, classificacao] of cadastro) {
        data[produto] = { subgrupo: classificacao.subgrupo.trim() };
      }
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao buscar classificação dos produtos", error);
    return NextResponse.json({ error: "Erro ao buscar classificação dos produtos" }, { status: 500 });
  }
}
