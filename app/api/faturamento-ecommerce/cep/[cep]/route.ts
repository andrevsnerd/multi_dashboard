import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce } from "@/lib/auth/faturamento-ecommerce-guard";
import { consultarCep } from "@/lib/faturamento-ecommerce/cep";

export async function GET(request: Request, ctx: { params: Promise<{ cep: string }> }) {
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  const { cep } = await ctx.params;
  if (String(cep ?? "").replace(/\D/g, "").length !== 8) {
    return NextResponse.json({ error: "CEP inválido (8 dígitos)." }, { status: 400 });
  }
  const data = await consultarCep(cep);
  if (!data) return NextResponse.json({ error: "CEP não encontrado." }, { status: 404 });
  return NextResponse.json({ data });
}
