import { NextResponse } from "next/server";

import {
  deleteCompraTransito,
  getCompraTransito,
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
