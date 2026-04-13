import { NextResponse } from "next/server";

import {
  deleteCompraSalva,
  getCompraSalva,
  removeCompraSalvaItem,
  toggleCompraSalvaComprada,
  updateCompraSalvaItemQtd,
  updateCompraSalvaTitle,
} from "@/lib/utils/compra-salva-store";

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
    const data = await getCompraSalva(companyKey, id);
    if (!data) {
      return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar compra salva", error);
    return NextResponse.json({ error: "Erro ao carregar compra salva" }, { status: 500 });
  }
}

export async function PATCH(
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
    const body = await request.json();
    const { title, itemKey, qtdManual, removeItemKey, comprada } = body ?? {};

    if (typeof comprada === "boolean") {
      const updated = await toggleCompraSalvaComprada(companyKey, id, comprada);
      if (!updated) {
        return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
      }
      return NextResponse.json({ data: updated });
    }

    if (typeof title === "string" && title.trim()) {
      const updated = await updateCompraSalvaTitle(companyKey, id, title);
      if (!updated) {
        return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
      }
      return NextResponse.json({ data: updated });
    }

    if (typeof removeItemKey === "string" && removeItemKey) {
      const updated = await removeCompraSalvaItem(companyKey, id, removeItemKey);
      if (!updated) {
        return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
      }
      return NextResponse.json({ data: updated });
    }

    if (typeof itemKey === "string" && itemKey) {
      const updated = await updateCompraSalvaItemQtd(companyKey, id, itemKey, Number(qtdManual ?? 0));
      if (!updated) {
        return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
      }
      return NextResponse.json({ data: updated });
    }

    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  } catch (error) {
    console.error("Erro ao atualizar compra salva", error);
    return NextResponse.json({ error: "Erro ao atualizar compra salva" }, { status: 500 });
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
    const ok = await deleteCompraSalva(companyKey, id);
    if (!ok) {
      return NextResponse.json({ error: "Compra salva não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir compra salva", error);
    return NextResponse.json({ error: "Erro ao excluir compra salva" }, { status: 500 });
  }
}
