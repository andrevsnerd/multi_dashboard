import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import type { CompraGastoLoteInput } from "@/lib/types/compra-gasto";
import { deleteLote, getLote, updateLote } from "@/lib/utils/compra-gastos-store";

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
    const data = await getLote(companyKey, id);
    if (!data) return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar compra", error);
    return NextResponse.json({ error: "Erro ao carregar compra" }, { status: 500 });
  }
}

/**
 * Atualiza o lote.
 *
 * Atalho `{ parcelaIndex, pago }` marca/desmarca uma parcela como paga sem
 * reenviar o lote inteiro — é a ação mais frequente da tela.
 */
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
    const bloqueado = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as Partial<CompraGastoLoteInput> & {
      parcelaIndex?: number;
      pago?: boolean;
    };

    if (typeof body?.parcelaIndex === "number" && typeof body?.pago === "boolean") {
      const atual = await getLote(companyKey, id);
      if (!atual) return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 });
      const i = body.parcelaIndex;
      if (i < 0 || i >= atual.parcelas.length) {
        return NextResponse.json({ error: "Parcela inexistente" }, { status: 400 });
      }
      const parcelas = atual.parcelas.map((p, idx) =>
        idx === i
          ? {
              ...p,
              pago: body.pago as boolean,
              dataPagamento: body.pago ? new Date().toISOString().slice(0, 10) : null,
            }
          : p
      );
      const atualizado = await updateLote(companyKey, id, { parcelas });
      return NextResponse.json({ data: atualizado });
    }

    const atualizado = await updateLote(companyKey, id, body);
    if (!atualizado) return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 });
    return NextResponse.json({ data: atualizado });
  } catch (error) {
    console.error("Erro ao atualizar compra", error);
    return NextResponse.json({ error: "Erro ao atualizar compra" }, { status: 500 });
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
    const bloqueado = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (bloqueado) return bloqueado;

    const ok = await deleteLote(companyKey, id);
    if (!ok) return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir compra", error);
    return NextResponse.json({ error: "Erro ao excluir compra" }, { status: 500 });
  }
}
