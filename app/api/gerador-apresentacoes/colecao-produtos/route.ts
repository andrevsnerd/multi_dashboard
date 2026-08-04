import { NextResponse } from "next/server";

import { fetchProdutosDaColecaoPorNome } from "@/lib/repositories/colecaoPresentation";

/**
 * Prévia do reconhecimento de produtos do slide de destaque: dado um termo
 * (ex.: "Dracena"), devolve os produtos da(s) coleção(ões) selecionada(s) que
 * casam com ele.
 *
 * Usa a MESMA função que o deck usa para montar o destaque, então o que a página
 * mostra antes de gerar é exatamente o que entra no slide.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company");
  const termo = searchParams.get("termo") ?? "";
  const colecoes = searchParams.getAll("colecao");

  if (company !== "scarfme") {
    return NextResponse.json(
      { error: "Disponível apenas para ScarfMe." },
      { status: 400 }
    );
  }

  try {
    const data = await fetchProdutosDaColecaoPorNome({ colecoes, termo });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao reconhecer produtos da coleção", error);
    return NextResponse.json({ error: "Erro ao buscar produtos." }, { status: 500 });
  }
}
