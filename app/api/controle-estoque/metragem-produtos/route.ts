import { NextResponse } from "next/server";

import { resolveMetragemProduto, temRegrasMetragem, type MetragemProduto } from "@/lib/config/metragem-produto";
import { fetchClassificacaoMetragemPorProdutos } from "@/lib/repositories/controleEstoque";

/**
 * Metragem de tecido por peça dos produtos pedidos. Só volta quem casa uma regra de
 * lib/config/metragem-produto.ts — produto ausente na resposta = sem metragem cadastrada.
 *
 * POST { company, produtos: string[] } → { data: Record<produto, MetragemProduto> }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { company?: string; produtos?: unknown };
    const companyKey = String(body?.company ?? "");
    if (!companyKey) {
      return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
    }
    const produtos = Array.isArray(body?.produtos)
      ? body.produtos.map((p) => String(p ?? "").trim()).filter(Boolean)
      : [];

    const data: Record<string, MetragemProduto> = {};
    if (produtos.length === 0 || !temRegrasMetragem(companyKey)) {
      return NextResponse.json({ data });
    }

    const cadastro = await fetchClassificacaoMetragemPorProdutos(produtos);
    for (const [produto, classificacao] of cadastro) {
      const metragem = resolveMetragemProduto(companyKey, classificacao);
      if (metragem) data[produto] = metragem;
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao buscar metragem dos produtos", error);
    return NextResponse.json({ error: "Erro ao buscar metragem dos produtos" }, { status: 500 });
  }
}
