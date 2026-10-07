import { NextResponse } from "next/server";

import { autorizarPlanejamento } from "@/lib/auth/planejamento-receita-guard";
import { getPlanejamentoEmpresa } from "@/lib/config/planejamento-receita";
import { fetchReceitaRealizadaMensal } from "@/lib/repositories/planejamentoReceita";
import type { PlanejamentoReceitaResponse } from "@/lib/types/planejamento-receita";
import { listAnosOrcado, resolverOrcado } from "@/lib/utils/planejamento-receita-store";

/**
 * Orçado (planilha + edições da tela) × realizado (Linx, regra canônica) por mês e canal.
 * O orçado é a meta da empresa: só quem tem a página liberada lê.
 */
export async function GET(request: Request) {
  const autorizado = await autorizarPlanejamento(request);
  if ("erro" in autorizado) return autorizado.erro;

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? "";
  const plano = getPlanejamentoEmpresa(company);
  if (!plano) {
    return NextResponse.json({ error: "Empresa sem planejamento cadastrado." }, { status: 404 });
  }

  const ano = Number(searchParams.get("year"));

  try {
    const [anos, resolvido, anterior] = await Promise.all([
      listAnosOrcado(company),
      resolverOrcado(company, ano),
      resolverOrcado(company, ano - 1),
    ]);
    if (!resolvido) {
      return NextResponse.json({ error: `Sem orçado para ${searchParams.get("year")}.` }, { status: 404 });
    }

    const { meses, hoje, consultadoEm } = await fetchReceitaRealizadaMensal(company, ano, {
      fresh: searchParams.get("fresh") === "1",
    });
    const body: PlanejamentoReceitaResponse = {
      company,
      ano,
      anosDisponiveis: anos,
      orcado: resolvido.orcado,
      planilha: resolvido.planilha,
      edicoes: resolvido.edicoes,
      podeEditar: autorizado.auth.podeEditar,
      orcadoAnoAnterior: anterior?.orcado ?? null,
      cenarios: plano.cenarios,
      fonte: plano.fonte,
      meses,
      hoje: hoje.iso,
      consultadoEm: consultadoEm.toISOString(),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Erro ao carregar planejamento de receita", error);
    return NextResponse.json({ error: "Erro ao carregar o planejamento." }, { status: 500 });
  }
}
