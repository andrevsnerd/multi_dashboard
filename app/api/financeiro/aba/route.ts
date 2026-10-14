import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { dataIso, empresaDaUrl, inteiro, lista, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { type FiltroAba, consultarAba } from "@/lib/financeiro/store";

/** Linhas de qualquer aba gravada, na estrutura da planilha (+ série mensal opcional). */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const p = url.searchParams;
  const aba = p.get("aba");
  if (!aba) return NextResponse.json({ error: "Informe a aba." }, { status: 400 });
  const campo = p.get("campoData");
  const ordem = p.get("ordem");
  const filtro: FiltroAba = {
    aba,
    q: p.get("q") || undefined,
    campoData: campo === "data_competencia" || campo === "mes_competencia" ? campo : "data_caixa",
    de: dataIso(p.get("de")),
    ate: dataIso(p.get("ate")),
    ordem: ordem === "data_desc" || ordem === "data_asc" ? ordem : "linha",
    pagina: inteiro(p.get("pagina"), 1, 1, 100000),
    porPagina: inteiro(p.get("porPagina"), 100, 10, 5000),
    somarExtras: lista(p.get("somar")),
    serieMensal: p.get("serie") === "1",
  };
  try {
    return NextResponse.json(await consultarAba(empresa, filtro));
  } catch (erro) {
    return respostaErro("aba", erro);
  }
}
