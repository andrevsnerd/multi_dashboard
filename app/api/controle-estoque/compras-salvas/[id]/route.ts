import { NextResponse } from "next/server";

import { fetchCustosPorProdutos } from "@/lib/repositories/controleEstoque";
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

    // Enriquece itens sem custoUnitario salvo buscando do ERP
    const semCusto = data.items.filter((i) => !(i.custoUnitario && i.custoUnitario > 0));
    if (semCusto.length > 0) {
      const produtos = [...new Set(semCusto.map((i) => i.produto.trim()).filter(Boolean))];
      let custoMap = new Map<string, number>();
      try {
        custoMap = await fetchCustosPorProdutos(produtos);
      } catch {
        // fallback silencioso — retorna sem custo enriquecido
      }
      if (custoMap.size > 0) {
        data.items = data.items.map((i) => {
          if (i.custoUnitario && i.custoUnitario > 0) return i;
          const custo = custoMap.get(i.produto.trim());
          return custo && custo > 0 ? { ...i, custoUnitario: custo } : i;
        });
      }
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
