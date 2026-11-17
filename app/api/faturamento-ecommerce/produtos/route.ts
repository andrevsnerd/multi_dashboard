import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { PADROES } from "@/lib/faturamento-ecommerce/config";
import { buscarProdutosFat } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

/** Produto por código de barras (SKU do site), código ou descrição; estoque da filial emissora. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  const filiais = PADROES[a.auth.empresa].nota.filiais;
  const filial = filiais.includes(sp.get("filial") ?? "") ? (sp.get("filial") as string) : filiais[0];
  try {
    const data = await buscarProdutosFat({ termo: sp.get("q") ?? "", filial, tabelaPreco: sp.get("tab") ?? "01" });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/produtos]", err);
    return erroJson(err);
  }
}
