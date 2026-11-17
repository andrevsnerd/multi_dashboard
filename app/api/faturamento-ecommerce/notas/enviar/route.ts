import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { enviarNotaSefaz } from "@/lib/repositories/faturamentoEcommerce/sefaz";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";

export const maxDuration = 180;

/** Envia a NF-e à SEFAZ pela Fiscal Flow — mesmo fluxo do "Envia NFe para Sefaz" do Linx. */
export async function POST(request: Request) {
  let body: { empresa?: string; filial?: string; nf?: string; serie?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, body.empresa, { escrita: true });
  if ("erro" in a) return a.erro;
  try {
    const usuarioLinx = await resolveResponsavelLinx(a.auth.username);
    const data = await enviarNotaSefaz({
      empresa: a.auth.empresa,
      filial: String(body.filial ?? ""),
      nf: String(body.nf ?? ""),
      serie: String(body.serie ?? ""),
      usuarioLinx,
    });
    console.info(`[faturamento-ecommerce] envio SEFAZ NF ${body.nf}/${body.serie} ${body.filial} por ${a.auth.username}: ${data.situacao} ${data.mensagem}`);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas/enviar]", err);
    return erroJson(err, 400);
  }
}
