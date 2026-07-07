import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { getPedido, updatePedidoStatus } from "@/lib/repositories/corporativoStore";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pedido = await getPedido(id);
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
    return NextResponse.json({ data: pedido });
  } catch (error) {
    console.error("Erro ao buscar pedido", error);
    return NextResponse.json({ error: "Erro ao buscar pedido." }, { status: 500 });
  }
}

/** Atualiza o status do pedido (admin). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = request.headers.get("x-auth-username");
  const user = username ? await findUserByUsername(username) : null;
  if (user?.role !== "admin")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const status = String(body.status ?? "").trim();
    if (!status) return NextResponse.json({ error: "Status é obrigatório." }, { status: 400 });
    await updatePedidoStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar pedido.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
