import { NextResponse } from "next/server";

import { listCatalogo, getCoverImagens } from "@/lib/repositories/corporativoStore";
import { fetchProdutosMeta } from "@/lib/repositories/corporativoProdutos";

export const maxDuration = 60;

export interface LojaProdutoCard {
  produto: string;
  descProduto: string;
  ean: string;
  categoria: string;
  /** PRODUTOS.GRADE (ex: "90x90") — mostrado entre parênteses ao lado do nome. */
  grade: string;
  precoAtacado: number;
  imagem: string | null;
}

/**
 * Vitrine da loja corporativa: produtos ativos do catálogo, com preço de atacado
 * manual, categoria (sempre o SUBGRUPO ao vivo do Linx) e imagem de capa (se houver).
 * Aceita ?q= (busca por descrição/EAN/código) e ?categoria= (filtro).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const categoriaFiltro = (searchParams.get("categoria") ?? "").trim();

    const items = await listCatalogo({ ativoOnly: true });
    if (items.length === 0) return NextResponse.json({ data: [], categorias: [] });

    const produtos = items.map((i) => i.produto);
    const [meta, covers] = await Promise.all([
      fetchProdutosMeta(produtos).catch(() => new Map()),
      getCoverImagens(produtos).catch(() => new Map<string, string>()),
    ]);

    const cards: LojaProdutoCard[] = items.map((i) => {
      const m = meta.get(i.produto);
      const desc = m?.descProduto || i.descProduto;
      const ean = m?.ean || i.ean;
      // Categoria da vitrine é SEMPRE o SUBGRUPO ao vivo — sem override salvo, sem fallback pro grupo.
      const categoria = m?.subgrupo || "";
      return {
        produto: i.produto,
        descProduto: desc,
        ean,
        categoria,
        grade: m?.grade || "",
        precoAtacado: i.precoAtacado,
        imagem: covers.get(i.produto) ?? null,
      };
    });

    // Categorias disponíveis (para os chips de filtro).
    const categorias = [...new Set(cards.map((c) => c.categoria).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );

    let filtered = cards;
    if (categoriaFiltro) {
      filtered = filtered.filter((c) => c.categoria === categoriaFiltro);
    }
    if (q) {
      filtered = filtered.filter(
        (c) =>
          c.descProduto.toLowerCase().includes(q) ||
          c.ean.toLowerCase().includes(q) ||
          c.produto.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ data: filtered, categorias });
  } catch (error) {
    console.error("Erro na vitrine da loja corporativa", error);
    return NextResponse.json({ error: "Erro ao carregar a vitrine." }, { status: 500 });
  }
}
