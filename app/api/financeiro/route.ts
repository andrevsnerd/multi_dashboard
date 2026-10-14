import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { empresaDaUrl, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { obterMeta } from "@/lib/financeiro/store";

/** Abas gravadas, última importação e se o usuário pode importar. */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  try {
    const meta = await obterMeta(empresa);
    return NextResponse.json({ ...meta, podeImportar: autorizado.auth.podeImportar });
  } catch (erro) {
    return respostaErro("meta", erro);
  }
}
