import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { fetchNotaFat } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await fetchNotaFat({
      empresa: a.auth.empresa,
      filial: sp.get("filial") ?? "",
      nf: sp.get("nf") ?? "",
      serie: sp.get("serie") ?? "",
    });
    if (!data) return NextResponse.json({ error: "NF não encontrada." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas/detalhe]", err);
    return erroJson(err);
  }
}
