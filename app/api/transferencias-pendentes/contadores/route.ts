import { NextResponse } from "next/server";

import { contadoresPorOrigemDestino } from "@/lib/utils/transferencia-pendente-store";

/**
 * GET /api/transferencias-pendentes/contadores?company=X&days=30
 *
 * Devolve agregados leves para exibir badges nas tabs "Realizadas" de cada
 * destinationGroup do controle de transferências.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = (searchParams.get("company") || "").trim();
    if (!company) {
      return NextResponse.json(
        { error: "Parâmetro 'company' é obrigatório." },
        { status: 400 }
      );
    }

    const daysParam = parseInt(searchParams.get("days") || "", 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;

    const data = await contadoresPorOrigemDestino(company, days);
    return NextResponse.json({ data, days });
  } catch (error: unknown) {
    console.error("[GET /api/transferencias-pendentes/contadores] erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular contadores." },
      { status: 500 }
    );
  }
}
