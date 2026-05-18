import { NextResponse } from "next/server";

import type { CompraTransitoItemRow } from "@/lib/types/compra-transito";
import {
  deleteCompraTransito,
  getCompraTransito,
  updateCompraTransito,
} from "@/lib/utils/compra-transito-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const { id } = await params;

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }

  try {
    const data = await getCompraTransito(companyKey, id);
    if (!data) {
      return NextResponse.json(
        { error: "Compra em trânsito não encontrada" },
        { status: 404 }
      );
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao carregar compra em trânsito" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { companyKey, title, items, draft } = body ?? {};

    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items deve ser um array com ao menos um item" },
        { status: 400 }
      );
    }

    if (!draft) {
      const hasInvalid = (items as CompraTransitoItemRow[]).some(
        (item) =>
          !String(item.itemKey ?? "").trim() ||
          !String(item.produto ?? "").trim() ||
          !String(item.dataRecebimento ?? "").trim() ||
          Math.round(Number(item.quantidade ?? 0)) <= 0
      );
      if (hasInvalid) {
        return NextResponse.json(
          { error: "Todos os itens precisam ter produto, data de recebimento e quantidade maior que zero." },
          { status: 400 }
        );
      }
    }

    const updated = await updateCompraTransito(String(companyKey), id, {
      title: typeof title === "string" ? title : undefined,
      items: items as CompraTransitoItemRow[],
    });

    if (!updated) {
      return NextResponse.json({ error: "Compra em trânsito não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Erro ao atualizar compra em trânsito", error);
    return NextResponse.json({ error: "Erro ao atualizar compra em trânsito" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const { id } = await params;

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }

  try {
    const ok = await deleteCompraTransito(companyKey, id);
    if (!ok) {
      return NextResponse.json(
        { error: "Compra em trânsito não encontrada" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao excluir compra em trânsito" },
      { status: 500 }
    );
  }
}
