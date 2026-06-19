import { NextResponse } from "next/server";

import { runReport } from "@/lib/reports/registry.server";
import type { SourceId } from "@/lib/reports/column-sources";
import type { ReportFilters } from "@/lib/reports/types";

const VALID_SOURCES: SourceId[] = ["vendas", "estoque", "parados", "cadastro"];

// Pro: até 300s. Algumas análises (estoque da rede inteira) varrem muitos itens.
export const maxDuration = 300;

/**
 * Rota genérica do Gerador de Relatórios: despacha para o fetcher da análise
 * indicada por `reportType`. Aceita o superconjunto de filtros; cada análise usa
 * apenas o que precisa.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const reportType = searchParams.get("reportType") ?? "";
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;

  const grupos = searchParams.getAll("grupo").filter(Boolean);
  const linhas = searchParams.getAll("linha").filter(Boolean);
  const subgrupos = searchParams.getAll("subgrupo").filter(Boolean);
  const grades = searchParams.getAll("grade").filter(Boolean);
  const colecoes = searchParams.getAll("colecao").filter(Boolean);
  const cores = searchParams.getAll("cor").filter(Boolean);
  const tipos = searchParams.getAll("tipo").filter(Boolean);
  const produtoId = searchParams.get("produtoId");
  const produtoSearchTerm = searchParams.get("produtoSearchTerm");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const estoquePorFilial = searchParams.get("estoquePorFilial") === "1";
  const compraIdeal = searchParams.get("compraIdeal") === "1";
  const extraSources = searchParams
    .getAll("src")
    .filter((s): s is SourceId => (VALID_SOURCES as string[]).includes(s));

  const filters: ReportFilters = {
    company,
    filial: filial || null,
    start,
    end,
    grupos: grupos.length > 0 ? grupos : null,
    linhas: linhas.length > 0 ? linhas : null,
    subgrupos: subgrupos.length > 0 ? subgrupos : null,
    grades: grades.length > 0 ? grades : null,
    colecoes: colecoes.length > 0 ? colecoes : null,
    cores: cores.length > 0 ? cores : null,
    tipos: tipos.length > 0 ? tipos : null,
    produtoId: produtoId || null,
    produtoSearchTerm: produtoSearchTerm || null,
    limit: Number.isFinite(limit) && (limit as number) > 0 ? limit : undefined,
    estoquePorFilial,
    compraIdeal,
  };

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
