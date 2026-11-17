import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { testarConexaoFiscalFlow } from "@/lib/repositories/faturamentoEcommerce/sefaz";

export const maxDuration = 60;

/** Testa a conexão com a Fiscal Flow: autentica e consulta a última NF autorizada. Não envia nada. */
export async function GET(request: Request) {
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await testarConexaoFiscalFlow(a.auth.empresa);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/sefaz/teste]", err);
    return erroJson(err, 400);
  }
}
