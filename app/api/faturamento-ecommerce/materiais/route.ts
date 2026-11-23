import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { buscarMateriaisFat } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

/** Materiais (cadastro MATERIAIS) para NF de material — remessa p/ industrialização, simples remessa. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    return NextResponse.json({ data: await buscarMateriaisFat(sp.get("q") ?? "") });
  } catch (err) {
    console.error("[faturamento-ecommerce/materiais]", err);
    return erroJson(err);
  }
}
