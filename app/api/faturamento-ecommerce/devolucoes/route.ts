import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { listarEntradasDevolviveis } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

/**
 * NFs de entrada (compra) da filial emissora que ainda têm saldo a devolver, por fornecedor ou nº
 * da NF — base da NF de devolução (117.11 / 150.01).
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await listarEntradasDevolviveis({
      empresa: a.auth.empresa,
      filial: sp.get("filial") ?? "",
      busca: sp.get("q") ?? "",
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/devolucoes]", err);
    return erroJson(err);
  }
}
