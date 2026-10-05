import { NextResponse } from "next/server";

import { fetchVendasDaColecao } from "@/lib/repositories/colecaoPresentation";

export const maxDuration = 300;

/**
 * Prévia das vendas do Relatório Completo de Coleção, linha a linha (ticket/NF ×
 * produto × cor × tamanho), para o usuário escolher quais saem do relatório.
 *
 * Usa a MESMA função que o deck usa para abater as vendas tiradas, então a chave
 * de cada linha daqui é exatamente a que o POST /colecao reconhece.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company");
  const filial = searchParams.get("filial");
  const colecoes = searchParams.getAll("colecao");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (company !== "scarfme") {
    return NextResponse.json({ error: "Disponível apenas para ScarfMe." }, { status: 400 });
  }
  if (colecoes.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma coleção." }, { status: 400 });
  }
  if (!start || !end) {
    return NextResponse.json({ error: "Informe o período (início e fim)." }, { status: 400 });
  }

  try {
    const data = await fetchVendasDaColecao({
      company,
      filial: filial || null,
      colecoes,
      range: { start, end },
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao listar vendas da coleção", error);
    return NextResponse.json({ error: "Erro ao listar as vendas." }, { status: 500 });
  }
}
