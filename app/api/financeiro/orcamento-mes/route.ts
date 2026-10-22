import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { dataIso, empresaDaUrl, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { obterOrcamentoMes } from "@/lib/financeiro/orcamento-mes";

/** Hoje no fuso de Brasília (o servidor roda em UTC). */
const hojeBrasil = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Orçado × gasto do mês até `posicao` (padrão: hoje), por linha do budget. */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const posicao = dataIso(url.searchParams.get("posicao")) ?? hojeBrasil();
  try {
    return NextResponse.json(await obterOrcamentoMes(empresa, posicao));
  } catch (erro) {
    return respostaErro("orcamento-mes", erro);
  }
}
