import { NextResponse } from "next/server";

import { resolverProdutosPorCodigo } from "@/lib/repositories/produtoCodigos";

export const maxDuration = 60;

/**
 * Resolve em LOTE uma lista de códigos colados (código de barra interno ou código do
 * produto) → produto × cor, para o campo "Colar lista de códigos" do Gerador de Relatórios.
 *
 * POST { codigos: string[] } → { itens: [...], naoEncontrados: [...] }
 *
 * Uma requisição para a lista inteira (a Lista Loja faz 2 por código, no cliente). Os
 * códigos não reconhecidos voltam nomeados para a tela avisar quais foram — código colado
 * que não casa NUNCA pode ser descartado em silêncio.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { codigos?: unknown } | null;
    const codigos = Array.isArray(body?.codigos)
      ? body!.codigos.map((c) => String(c ?? "")).filter(Boolean)
      : [];

    if (codigos.length === 0) {
      return NextResponse.json({ itens: [], naoEncontrados: [] });
    }
    if (codigos.length > 2000) {
      return NextResponse.json(
        { error: "Cole no máximo 2.000 códigos por vez" },
        { status: 400 }
      );
    }

    const result = await resolverProdutosPorCodigo(codigos);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao resolver códigos de produto", error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json({ error: "Erro ao resolver códigos", details }, { status: 500 });
  }
}
