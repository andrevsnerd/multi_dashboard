import { NextResponse } from "next/server";

import { getControleEstoqueMetricasItens } from "@/lib/server/controle-estoque-metricas";
import { dedupeControleEstoqueItens, type ControleEstoqueMetricasItensPayload } from "@/lib/utils/controle-estoque-metricas";

export async function POST(request: Request) {
  let body: ControleEstoqueMetricasItensPayload;

  try {
    body = (await request.json()) as ControleEstoqueMetricasItensPayload;
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const itens = dedupeControleEstoqueItens(body.itens ?? []);
  if (itens.length === 0) {
    return NextResponse.json({ data: {} });
  }

  try {
    const data = await getControleEstoqueMetricasItens({
      company: body.company,
      filial: body.filial ?? null,
      includeHistorico: Boolean(body.includeHistorico),
      itens,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar metricas em lote dos itens", error);
    return NextResponse.json(
      { error: "Erro ao carregar metricas em lote dos itens" },
      { status: 500 }
    );
  }
}
