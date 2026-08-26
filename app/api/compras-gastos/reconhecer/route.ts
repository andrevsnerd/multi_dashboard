import { NextResponse } from "next/server";

import { materializarCompraSalva } from "@/lib/utils/compra-gastos-import";

/**
 * Prévia de uma Compra Salva já reconhecida: itens com custo, valor exato e a
 * data em que a compra foi fechada.
 *
 * É o que o modal de nova compra mostra assim que você escolhe a Compra Salva,
 * para não haver redigitação. O valor aqui é o exato (`qtd × custo` somado),
 * diferente da listagem de Compras Salvas, que arredonda item por item.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const compraSalvaId = searchParams.get("compraSalvaId") ?? "";

  if (!companyKey || !compraSalvaId) {
    return NextResponse.json(
      { error: "company e compraSalvaId são obrigatórios" },
      { status: 400 }
    );
  }
  try {
    const candidata = await materializarCompraSalva(companyKey, compraSalvaId);
    if (!candidata) {
      return NextResponse.json({ error: "Compra Salva não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ candidata });
  } catch (error) {
    console.error("Erro ao ler itens da compra salva", error);
    return NextResponse.json({ error: "Erro ao ler os itens da Compra Salva" }, { status: 500 });
  }
}
