import { NextResponse } from "next/server";

import {
  fetchAumentosDescontos,
  fetchAumentosDescontosDetalhe,
} from "@/lib/repositories/aumentosDescontos";

// Pro: até 300s. A consulta de vendas (rede inteira) pode varrer muitos itens.
export const maxDuration = 300;

/**
 * Rota da página "Aumentos e Descontos". Aceita o mesmo superconjunto de filtros
 * do Gerador de Relatórios (período, filial, grupo/linha/subgrupo/grade/coleção,
 * cor, tipo) e devolve a decomposição por produto × cor em descontos e aumentos.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

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
  const view = searchParams.get("view"); // "detalhe" → transação a transação

  const commonFilters = {
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
  };

  try {
    const result =
      view === "detalhe"
        ? await fetchAumentosDescontosDetalhe(commonFilters)
        : await fetchAumentosDescontos(commonFilters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao gerar Aumentos e Descontos", error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    if (error instanceof Error && "code" in error && error.code === "ETIMEOUT") {
      return NextResponse.json(
        { error: "Timeout: a consulta demorou demais. Reduza o escopo ou aplique filtros.", code: "ETIMEOUT" },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: "Erro ao gerar análise", details }, { status: 500 });
  }
}
