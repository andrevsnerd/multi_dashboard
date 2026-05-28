import { NextResponse } from "next/server";

import { getCooldownKeys } from "@/lib/utils/transferencia-pendente-store";

/**
 * GET /api/transferencias-pendentes/cooldown?company=X&days=7
 *
 * Devolve as chaves para o cooldown que o frontend aplica em `calculateTransfers`.
 * Cada chave tem a forma `${produto}|${corCodigo}|${origemCanonicoUpper}`.
 *
 * O frontend usa para descartar origens que enviaram esse produto+cor nos
 * últimos N dias, evitando sugerir saída repetida.
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
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

    const keys = await getCooldownKeys(company, days);
    return NextResponse.json({ keys, days });
  } catch (error: unknown) {
    console.error("[GET /api/transferencias-pendentes/cooldown] erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular cooldown." },
      { status: 500 }
    );
  }
}
