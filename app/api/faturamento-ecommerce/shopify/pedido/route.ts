import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { importarPedidoShopifyFat } from "@/lib/repositories/faturamentoEcommerce/shopify";

export const maxDuration = 60;

/** Importa um pedido: dados do cliente, clientes parecidos no Linx e itens mapeados. Não grava nada. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await importarPedidoShopifyFat(a.auth.empresa, sp.get("nome") ?? "", sp.get("filial") ?? undefined);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/shopify/pedido]", err);
    return erroJson(err, 400);
  }
}
