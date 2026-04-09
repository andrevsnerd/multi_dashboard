import { NextResponse } from "next/server";

import type { CompraSalvaItemRow } from "@/lib/types/compra-salva";
import { createCompraSalva, listComprasSalvas } from "@/lib/utils/compra-salva-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    const data = await listComprasSalvas(companyKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar compras salvas", error);
    return NextResponse.json({ error: "Erro ao listar compras salvas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      companyKey,
      sourceContextKey,
      title,
      expandirPorCor,
      items,
    } = body ?? {};

    if (!companyKey || !sourceContextKey) {
      return NextResponse.json({ error: "companyKey e sourceContextKey são obrigatórios" }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items deve ser um array" }, { status: 400 });
    }

    const normalizedItems: CompraSalvaItemRow[] = items.map((row: CompraSalvaItemRow) => ({
      itemKey: String(row.itemKey ?? ""),
      produto: String(row.produto ?? ""),
      corProduto: row.corProduto ? String(row.corProduto) : undefined,
      corDescricao: row.corDescricao ? String(row.corDescricao) : undefined,
      descricao: String(row.descricao ?? row.produto ?? ""),
      grade: row.grade ? String(row.grade) : undefined,
      colecao: row.colecao ? String(row.colecao) : undefined,
      qtdManual: Number(row.qtdManual ?? 0),
    }));

    const t =
      typeof title === "string" && title.trim()
        ? title.trim()
        : `Compra ${new Date().toLocaleDateString("pt-BR")}`;

    const created = await createCompraSalva({
      companyKey,
      sourceContextKey,
      title: t,
      expandirPorCor: !!expandirPorCor,
      items: normalizedItems,
    });

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("Erro ao criar compra salva", error);
    return NextResponse.json({ error: "Erro ao criar compra salva" }, { status: 500 });
  }
}
