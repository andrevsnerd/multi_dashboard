import { NextResponse } from "next/server";

import { materializarCompraTransito } from "@/lib/utils/compra-gastos-import";

/**
 * Prévia de uma Compra em trânsito já reconhecida: itens com custo, valor exato,
 * a data em que o trânsito foi confirmado e a previsão de chegada.
 *
 * É o que o modal de nova compra mostra assim que você escolhe a compra, para
 * não haver redigitação. O valor aqui é o exato (`qtd × custo` somado),
 * diferente da listagem de Compras em trânsito, que arredonda item por item.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const compraTransitoId = searchParams.get("compraTransitoId") ?? "";

  if (!companyKey || !compraTransitoId) {
    return NextResponse.json(
      { error: "company e compraTransitoId são obrigatórios" },
      { status: 400 }
    );
  }
  try {
    const candidata = await materializarCompraTransito(companyKey, compraTransitoId);
    if (!candidata) {
      return NextResponse.json({ error: "Compra em trânsito não encontrada" }, { status: 404 });
    }
    // Rascunho não é compra confirmada: a prévia recusa em vez de deixar o
    // usuário lançar uma lista que ainda está sendo montada.
    if (candidata.status === "rascunho") {
      return NextResponse.json(
        {
          error:
            "Esta compra em trânsito ainda é um rascunho. Só compras confirmadas em trânsito entram no painel.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ candidata });
  } catch (error) {
    console.error("Erro ao ler itens da compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao ler os itens da Compra em trânsito" },
      { status: 500 }
    );
  }
}
