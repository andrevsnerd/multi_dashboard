import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { canApproveCadastro, normalizeRole } from "@/lib/auth/permissions";
import { getPedido, marcarPedidoEfetivado, type PedidoItem } from "@/lib/repositories/corporativoStore";
import { criarPedidoVendaLinx } from "@/lib/repositories/pedidoVendaLinx";

export const maxDuration = 120;

/**
 * EFETIVA um pedido do e-commerce corporativo, criando o Pedido de Venda Atacado
 * real no Linx (VENDAS + VENDAS_PRODUTO) e gravando o número de volta no Neon.
 *
 * Só admin/diretor/supervisor (canApproveCadastro) — exceção ao read-only geral,
 * igual à aprovação de autocadastro. O aprovador pode ter editado itens/observação:
 * se vierem no corpo, sobrescrevem os salvos.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const username = request.headers.get("x-auth-username");
  const approver = username ? await findUserByUsername(username) : null;
  if (!approver || !canApproveCadastro(normalizeRole(approver.role))) {
    return NextResponse.json({ error: "Não autorizado a efetivar pedidos." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const pedido = await getPedido(id);
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  if (pedido.pedidoLinx || pedido.status === "efetivado") {
    return NextResponse.json(
      { error: `Este pedido já foi efetivado no Linx (${pedido.pedidoLinx || "—"}).` },
      { status: 409 }
    );
  }

  // Payload final: o aprovador pode ter editado itens/observação antes de efetivar.
  let itensRaw: PedidoItem[] = pedido.itens;
  let observacao = pedido.observacao;
  try {
    const body = (await request.json()) as { itens?: PedidoItem[]; observacao?: string } | null;
    if (body?.itens && Array.isArray(body.itens) && body.itens.length > 0) itensRaw = body.itens;
    if (typeof body?.observacao === "string") observacao = body.observacao;
  } catch {
    // sem corpo → usa o pedido salvo
  }

  // Sanitiza itens e recalcula os totais no servidor (não confia no cliente).
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const itens: PedidoItem[] = itensRaw
    .map((i) => {
      const quantidade = Math.max(0, Math.round(Number(i.quantidade) || 0));
      const precoUnitario = round2(i.precoUnitario);
      return { ...i, quantidade, precoUnitario, subtotal: round2(quantidade * precoUnitario) };
    })
    .filter((i) => i.produto && i.quantidade > 0);
  if (itens.length === 0) {
    return NextResponse.json({ error: "O pedido precisa de ao menos um item com quantidade." }, { status: 400 });
  }
  const subtotal = round2(itens.reduce((s, i) => s + i.subtotal, 0));
  const total = round2(subtotal + (Number(pedido.frete) || 0));

  try {
    const { pedido: numero } = await criarPedidoVendaLinx({ ...pedido, itens, observacao, subtotal, total });
    await marcarPedidoEfetivado(id, {
      pedidoLinx: numero,
      por: approver.username,
      itens,
      observacao,
      subtotal,
      total,
    });
    return NextResponse.json({ data: { pedido: numero } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao efetivar o pedido no Linx.";
    console.error("Erro ao efetivar pedido corporativo", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
