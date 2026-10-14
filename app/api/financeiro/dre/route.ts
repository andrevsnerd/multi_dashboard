import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { dataIso, empresaDaUrl, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { obterDre } from "@/lib/financeiro/store";

/** Células da DRE (rótulo × mês) entre `de` e `ate`, mais o layout das linhas. */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const de = dataIso(url.searchParams.get("de")) ?? "1900-01-01";
  const ate = dataIso(url.searchParams.get("ate")) ?? "2999-12-31";
  try {
    return NextResponse.json(await obterDre(empresa, de, ate));
  } catch (erro) {
    return respostaErro("dre", erro);
  }
}
