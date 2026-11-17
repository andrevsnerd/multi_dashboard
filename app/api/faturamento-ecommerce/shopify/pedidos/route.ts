import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { listarPedidosShopifyFat } from "@/lib/repositories/faturamentoEcommerce/shopify";

export const maxDuration = 60;

/** Pedidos pagos da loja Shopify da empresa, com as NFs já emitidas para cada um. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await listarPedidosShopifyFat(a.auth.empresa, {
      busca: sp.get("busca") ?? undefined,
      dias: Number(sp.get("dias") ?? 10),
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/shopify/pedidos]", err);
    return erroJson(err);
  }
}
