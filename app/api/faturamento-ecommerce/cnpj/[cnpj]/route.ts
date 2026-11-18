import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { consultarCnpj } from "@/lib/faturamento-ecommerce/cnpj";

/** Consulta CNPJ (BrasilAPI) para autopreencher o cadastro PJ. */
export async function GET(request: Request, ctx: { params: Promise<{ cnpj: string }> }) {
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  const { cnpj } = await ctx.params;
  if (String(cnpj ?? "").replace(/\D/g, "").length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido (14 dígitos)." }, { status: 400 });
  }
  try {
    const data = await consultarCnpj(cnpj);
    if (!data) return NextResponse.json({ error: "CNPJ não encontrado na Receita." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/cnpj]", err);
    return erroJson(err, 502);
  }
}
