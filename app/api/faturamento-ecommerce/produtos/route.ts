import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { fetchFiliaisNota } from "@/lib/repositories/faturamentoEcommerce/clientes";
import { filiaisNotaDaEmpresa } from "@/lib/repositories/faturamentoEcommerce/filiais-nota";
import { buscarProdutosFat } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

/** Produto por código de barras (SKU do site), código ou descrição; estoque da filial emissora. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    // Estoque da filial emissora escolhida; sem ela (ou de outra empresa), a principal do rodízio.
    const pedida = sp.get("filial") ?? "";
    const filial = (await filiaisNotaDaEmpresa(a.auth.empresa)).includes(pedida)
      ? pedida
      : (await fetchFiliaisNota(a.auth.empresa)).padrao;
    const data = await buscarProdutosFat({ termo: sp.get("q") ?? "", filial, tabelaPreco: sp.get("tab") ?? "01" });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/produtos]", err);
    return erroJson(err);
  }
}
