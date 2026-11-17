import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { fetchXmlNota } from "@/lib/repositories/faturamentoEcommerce/notas";

export const maxDuration = 60;

/** Download do XML autorizado (nfeProc) de uma NF da empresa. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  const chave = (sp.get("chave") ?? "").replace(/\D/g, "");
  try {
    const xml = await fetchXmlNota({ empresa: a.auth.empresa, chave });
    if (!xml) return NextResponse.json({ error: "XML não encontrado (a NF ainda não foi autorizada?)." }, { status: 404 });
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${chave}-procNFe.xml"`,
      },
    });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas/xml]", err);
    return erroJson(err);
  }
}
