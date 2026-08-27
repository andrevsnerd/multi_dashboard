import { NextResponse } from "next/server";

import { runReport } from "@/lib/reports/registry.server";
import { parseExtraSources, parseReportFilters } from "@/lib/reports/params";

// Pro: até 300s. Algumas análises (estoque da rede inteira) varrem muitos itens.
export const maxDuration = 300;

/**
 * Rota genérica do Gerador de Relatórios: despacha para o fetcher da análise
 * indicada por `reportType`. Aceita o superconjunto de filtros; cada análise usa
 * apenas o que precisa. A leitura dos parâmetros é compartilhada com a rota de
 * streaming (`parseReportFilters`) — filtro novo entra lá, uma vez.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const reportType = searchParams.get("reportType") ?? "";
  const filters = parseReportFilters(searchParams);
  const extraSources = parseExtraSources(searchParams);

  try {
    const result = await runReport(reportType, filters, extraSources);
    if (!result) {
      return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Erro ao gerar relatório (${reportType})`, error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    if (error instanceof Error && "code" in error && error.code === "ETIMEOUT") {
      return NextResponse.json(
        { error: "Timeout: a consulta demorou demais. Reduza o escopo ou aplique filtros.", code: "ETIMEOUT" },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: "Erro ao gerar relatório", details }, { status: 500 });
  }
}
