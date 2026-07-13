import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { readOnlyBlock } from "@/lib/auth/route-guards";
import { criarPedido, listPedidos, type PedidoItem } from "@/lib/repositories/corporativoStore";

export const maxDuration = 60;

const FRETE_FIXO = 90;

/**
 * GET: lista pedidos.
 *  - admin  → todos os pedidos (gestão).
 *  - cliente_corporativo → apenas os do próprio cliente (via ?codigo= vinculado).
 * POST: cria um pedido (checkout). Persiste no Neon com status 'pendente'.
 */
export async function GET(request: Request) {
  try {
    const username = request.headers.get("x-auth-username");
    const user = username ? await findUserByUsername(username) : null;
    const { searchParams } = new URL(request.url);

    if (user?.role === "admin") {
      const data = await listPedidos({ limit: 500 });
      return NextResponse.json({ data });
    }

    // Não-admin: restringe ao cliente vinculado (ou ao passado em ?codigo=).
    const codigo = (searchParams.get("codigo") ?? user?.clienteCodigo ?? "").trim();
    if (!codigo) return NextResponse.json({ data: [] });
    const data = await listPedidos({ clienteCodigo: codigo, limit: 200 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar pedidos", error);
    return NextResponse.json({ error: "Erro ao listar pedidos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const readOnly = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (readOnly) return readOnly;
    const body = await request.json();
    const itens = Array.isArray(body.itens) ? (body.itens as PedidoItem[]) : [];
    if (itens.length === 0) {
      return NextResponse.json({ error: "O carrinho está vazio." }, { status: 400 });
    }

    // Recalcula subtotais no servidor a partir de preço × quantidade (não confia no cliente).
    const itensSeguros: PedidoItem[] = itens
      .map((i) => {
        const quantidade = Math.max(0, Math.floor(Number(i.quantidade ?? 0)));
        const precoUnitario = Number(i.precoUnitario ?? 0);
        return {
          produto: String(i.produto ?? "").trim(),
          descProduto: String(i.descProduto ?? ""),
          ean: String(i.ean ?? ""),
          cor: String(i.cor ?? ""),
          corNome: String(i.corNome ?? ""),
          tamanho: String(i.tamanho ?? ""),
          grade: String(i.grade ?? ""),
          quantidade,
          precoUnitario,
          subtotal: Number((precoUnitario * quantidade).toFixed(2)),
        };
      })
      .filter((i) => i.produto && i.quantidade > 0);

    if (itensSeguros.length === 0) {
      return NextResponse.json({ error: "Nenhum item válido no pedido." }, { status: 400 });
    }

    const pedido = await criarPedido({
      clienteCodigo: String(body.clienteCodigo ?? "").trim(),
      clienteNome: String(body.clienteNome ?? "").trim(),
      userId: String(body.userId ?? "").trim(),
      userNome: String(body.userNome ?? "").trim(),
      frete: FRETE_FIXO,
      endereco: body.endereco ?? null,
      itens: itensSeguros,
      observacao: String(body.observacao ?? ""),
    });

    return NextResponse.json({ data: pedido });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao finalizar o pedido.";
    console.error("Erro ao criar pedido", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
