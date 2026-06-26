import { NextResponse } from "next/server";

import type { CompraTransitoItemRow } from "@/lib/types/compra-transito";
import {
  deleteCompraTransito,
  getCompraTransito,
  updateCompraTransito,
} from "@/lib/utils/compra-transito-store";
import { fillMissingBarcodes } from "@/lib/server/compra-transito-barcodes";
import { applyAutoRecebimento } from "@/lib/server/compra-transito-recebimento";

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
    const createdByName = request.headers.get("x-auth-username") ?? undefined;
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

    // Na (re)confirmação, recalcula a data de recebimento dos itens não-manuais a partir de
    // AGORA + tempo de produção do ciclo. Antes da validação para datas automáticas valerem.
    const itemsComData = draft
      ? (items as CompraTransitoItemRow[])
      : await applyAutoRecebimento(String(companyKey), items as CompraTransitoItemRow[], new Date());

    if (!draft) {
      const hasInvalid = itemsComData.some(
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

    // Padroniza: completa o código de barras (do Linx) ausente. Aditivo e tolerante a falha.
    const { items: itemsComBarcode } = await fillMissingBarcodes(itemsComData);

    const updated = await updateCompraTransito(String(companyKey), id, {
      title: typeof title === "string" ? title : undefined,
      items: itemsComBarcode,
      forceStatus: draft ? "rascunho" : undefined,
      reconfirm: !draft,
      createdByName,
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
