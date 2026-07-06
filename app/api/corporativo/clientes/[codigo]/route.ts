import { NextResponse } from "next/server";

import { fetchClienteCorporativoDetalhe } from "@/lib/repositories/clienteCorporativo";

export const maxDuration = 30;

export async function GET(_request: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  try {
    const data = await fetchClienteCorporativoDetalhe(codigo);
    if (!data) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao buscar cliente corporativo", error);
    return NextResponse.json({ error: "Erro ao buscar cliente." }, { status: 500 });
  }
}
