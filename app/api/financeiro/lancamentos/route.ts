import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { dataIso, empresaDaUrl, inteiro, lista, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { type FiltroLancamentos, consultarLancamentos, opcoesLancamentos } from "@/lib/financeiro/store";

/**
 * Lançamentos das abas de despesa/receita financeira, com filtros, totais e séries.
 * `?opcoes=1` devolve só as opções dos filtros.
 */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const p = url.searchParams;
  try {
    if (p.get("opcoes") === "1") return NextResponse.json(await opcoesLancamentos(empresa));

    const ordem = p.get("ordem");
    const sinal = p.get("sinal");
    const filtro: FiltroLancamentos = {
      abas: lista(p.get("abas")),
      classificacoes: lista(p.get("classificacoes")),
      matrizes: lista(p.get("matrizes")),
      lojas: lista(p.get("lojas")),
      status: p.get("status") || undefined,
      formaPgto: p.get("forma") || undefined,
      data: p.get("data") === "caixa" ? "caixa" : "competencia",
      de: dataIso(p.get("de")),
      ate: dataIso(p.get("ate")),
      mesCompetencia: dataIso(p.get("mes")),
      sinal: sinal === "saida" || sinal === "entrada" ? sinal : undefined,
      q: p.get("q") || undefined,
      ordem: ordem === "data_asc" || ordem === "valor_asc" || ordem === "valor_desc" ? ordem : "data_desc",
      pagina: inteiro(p.get("pagina"), 1, 1, 100000),
      porPagina: inteiro(p.get("porPagina"), 100, 10, 1000),
    };
    return NextResponse.json(await consultarLancamentos(empresa, filtro));
  } catch (erro) {
    return respostaErro("lancamentos", erro);
  }
}
