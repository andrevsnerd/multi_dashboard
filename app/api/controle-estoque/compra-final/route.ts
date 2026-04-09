import { NextResponse } from "next/server";

import {
  listCompraFinalItems,
  removeCompraFinalItem,
  updateCompraFinalQtd,
  upsertCompraFinalItem,
} from "@/lib/utils/compra-final-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const contextKey = searchParams.get("contextKey") ?? "";
  if (!companyKey || !contextKey) {
    return NextResponse.json({ error: "company e contextKey são obrigatórios" }, { status: 400 });
  }
  try {
    const data = await listCompraFinalItems(companyKey, contextKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar compra final", error);
    return NextResponse.json({ error: "Erro ao carregar compra final" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      companyKey,
      contextKey,
      itemKey,
      produto,
      corProduto,
      corDescricao,
      descricao,
      grade,
      colecao,
      qtdManual,
    } = body ?? {};

    if (!companyKey || !contextKey || !itemKey || !produto || !descricao) {
      return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
    }

    await upsertCompraFinalItem({
      companyKey,
      contextKey,
      itemKey,
      produto,
      corProduto: corProduto ?? undefined,
      corDescricao: corDescricao ?? undefined,
      descricao,
      grade: grade ?? undefined,
      colecao: colecao ?? undefined,
      qtdManual: Number(qtdManual ?? 0),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar compra final", error);
    return NextResponse.json({ error: "Erro ao salvar compra final" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { companyKey, contextKey, itemKey, qtdManual } = body ?? {};
    if (!companyKey || !contextKey || !itemKey) {
      return NextResponse.json({ error: "companyKey, contextKey e itemKey são obrigatórios" }, { status: 400 });
    }
    await updateCompraFinalQtd(companyKey, contextKey, itemKey, Number(qtdManual ?? 0));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao atualizar qtd manual", error);
    return NextResponse.json({ error: "Erro ao atualizar qtd manual" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const contextKey = searchParams.get("contextKey") ?? "";
  const itemKey = searchParams.get("itemKey") ?? "";
  if (!companyKey || !contextKey || !itemKey) {
    return NextResponse.json({ error: "company, contextKey e itemKey são obrigatórios" }, { status: 400 });
  }
  try {
    await removeCompraFinalItem(companyKey, contextKey, itemKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao remover item compra final", error);
    return NextResponse.json({ error: "Erro ao remover item compra final" }, { status: 500 });
  }
}

