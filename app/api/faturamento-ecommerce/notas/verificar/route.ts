import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { verificarNotaSefaz } from "@/lib/repositories/faturamentoEcommerce/sefaz";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";

export const maxDuration = 60;

/**
 * Consulta a NF na SEFAZ (pela Fiscal Flow) e confere com o Linx. `aplicar: true` grava no
 * Linx a autorização encontrada na SEFAZ quando o Linx ainda não registrou.
 */
export async function POST(request: Request) {
  let body: { empresa?: string; filial?: string; nf?: string; serie?: string; aplicar?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, body.empresa, { escrita: Boolean(body.aplicar) });
  if ("erro" in a) return a.erro;
  try {
    const data = await verificarNotaSefaz({
      empresa: a.auth.empresa,
      filial: String(body.filial ?? ""),
      nf: String(body.nf ?? ""),
      serie: String(body.serie ?? ""),
      aplicar: Boolean(body.aplicar),
      usuarioLinx: body.aplicar ? await resolveResponsavelLinx(a.auth.username) : undefined,
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas/verificar]", err);
    return erroJson(err, 400);
  }
}
