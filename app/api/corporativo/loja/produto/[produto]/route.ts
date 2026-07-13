import { NextResponse } from "next/server";

import { getCatalogoItem, listProdutoImagens } from "@/lib/repositories/corporativoStore";
import { fetchProdutoDetalheLoja } from "@/lib/repositories/corporativoProdutos";

export const maxDuration = 60;

/**
 * Detalhe do produto na loja: metadados + cores (com EAN por cor) + imagens +
 * preço de atacado (do catálogo). Só serve produtos que estão no catálogo e ativos.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ produto: string }> }
) {
  try {
    const { produto } = await params;
    const cod = decodeURIComponent(produto ?? "").trim();
    if (!cod) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });

    const catalogo = await getCatalogoItem(cod);
    if (!catalogo || !catalogo.ativo) {
      return NextResponse.json({ error: "Produto não disponível." }, { status: 404 });
    }

    const [detalhe, imagens] = await Promise.all([
      fetchProdutoDetalheLoja(cod),
      listProdutoImagens(cod).catch(() => []),
    ]);

    if (!detalhe) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    // Imagens por cor: geral (cor='') + por cor. Front escolhe conforme a cor selecionada.
    const imagensGerais = imagens.filter((im) => !im.cor).map((im) => im.dataUrl);
    const imagensPorCor: Record<string, string[]> = {};
    for (const im of imagens) {
      if (!im.cor) continue;
      (imagensPorCor[im.cor] ??= []).push(im.dataUrl);
    }

    return NextResponse.json({
      data: {
        produto: detalhe.produto,
        descProduto: detalhe.descProduto,
        ean: detalhe.ean,
        grupo: detalhe.grupo,
        subgrupo: detalhe.subgrupo,
        linha: detalhe.linha,
        colecao: detalhe.colecao,
        // Categoria da página de produto vem do SUBGRUPO (mais específico que o grupo).
        categoria: catalogo.categoria?.trim() || detalhe.subgrupo || detalhe.grupo || "",
        precoAtacado: catalogo.precoAtacado,
        cores: detalhe.cores,
        imagensGerais,
        imagensPorCor,
      },
    });
  } catch (error) {
    console.error("Erro no detalhe do produto (loja)", error);
    return NextResponse.json({ error: "Erro ao carregar o produto." }, { status: 500 });
  }
}
