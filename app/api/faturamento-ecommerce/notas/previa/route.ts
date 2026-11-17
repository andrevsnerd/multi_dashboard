import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { previaNota } from "@/lib/repositories/faturamentoEcommerce/notas";
import type { NotaInput } from "@/lib/faturamento-ecommerce/types";

export const maxDuration = 60;

/** Prévia da NF: exceção fiscal, CFOP, CSOSN, totais, bloqueios e avisos. Não grava nada. */
export async function POST(request: Request) {
  let nota: NotaInput;
  try {
    nota = (await request.json()).nota;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, nota?.empresa);
  if ("erro" in a) return a.erro;
  try {
    const data = await previaNota({ ...nota, empresa: a.auth.empresa });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas/previa]", err);
    return erroJson(err, 400);
  }
}
