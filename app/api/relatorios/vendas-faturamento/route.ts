import { NextResponse } from "next/server";

import { getReportFetcher } from "@/lib/reports/registry.server";
import { VENDAS_FATURAMENTO_ID } from "@/lib/reports/vendas-faturamento";
import type { ReportFilters } from "@/lib/reports/types";

// Pro: até 300s. A consulta reusa fetchProductsWithDetails (vendas + estoque).
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;

  if (!start || !end) {
    return NextResponse.json(
      { error: "Parâmetros start e end são obrigatórios" },
      { status: 400 }
    );
  }

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
  };

  try {
    const fetcher = getReportFetcher(VENDAS_FATURAMENTO_ID);
    if (!fetcher) {
      return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
    }
    const result = await fetcher(filters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao gerar relatório de vendas por faturamento", error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    if (error instanceof Error && "code" in error && error.code === "ETIMEOUT") {
      return NextResponse.json(
        { error: "Timeout: a consulta demorou demais. Reduza o período ou aplique filtros.", code: "ETIMEOUT" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Erro ao gerar relatório", details },
      { status: 500 }
    );
  }
}
