import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { fetchFatLookups } from "@/lib/repositories/faturamentoEcommerce/clientes";

export const maxDuration = 60;

export async function GET(request: Request) {
  const empresa = new URL(request.url).searchParams.get("empresa");
  const a = await autorizarFaturamentoEcommerce(request, empresa);
  if ("erro" in a) return a.erro;
  try {
    const data = await fetchFatLookups(a.auth.empresa);
    return NextResponse.json({ data: { ...data, podeGravar: a.auth.podeGravar } });
  } catch (err) {
    console.error("[faturamento-ecommerce/lookups]", err);
    return erroJson(err);
  }
}
