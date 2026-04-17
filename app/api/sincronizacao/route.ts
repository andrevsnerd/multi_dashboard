import { NextResponse } from "next/server";

import { fetchSincronizacaoFiliais } from "@/lib/repositories/sincronizacao";

export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchSincronizacaoFiliais();
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar sincronizacao de vendas", error);
    return NextResponse.json(
      { error: "Erro ao carregar sincronizacao de vendas" },
      { status: 500 }
    );
  }
}
