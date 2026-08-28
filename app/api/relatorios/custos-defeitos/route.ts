import { NextResponse } from "next/server";

import { fetchCustosDefeitos } from "@/lib/repositories/reportCustosDefeitos";

export const maxDuration = 120;

/**
 * Análise "Custos de Defeitos" do Gerador de Relatórios.
 *
 * POST (não GET como as demais análises) porque a entrada é a LISTA COLADA de códigos —
 * com repetições, que são a quantidade. Uma lista de peças defeituosas facilmente passa
 * de mil linhas e não cabe numa query string.
 *
 * POST { codigos: string[] } → ReportResult (+ `naoEncontrados`).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { codigos?: unknown } | null;
    const codigos = Array.isArray(body?.codigos)
      ? body!.codigos.map((c) => String(c ?? "")).filter((c) => c.trim() !== "")
      : [];

    if (codigos.length === 0) {
      return NextResponse.json({ error: "Cole pelo menos um código." }, { status: 400 });
    }
    if (codigos.length > 5000) {
      return NextResponse.json(
        { error: "Cole no máximo 5.000 linhas por vez." },
        { status: 400 }
      );
    }

    const result = await fetchCustosDefeitos({ codigos });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao gerar o relatório de custos de defeitos", error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json({ error: "Erro ao gerar relatório", details }, { status: 500 });
  }
}
