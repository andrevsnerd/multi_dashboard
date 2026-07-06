import { NextResponse } from "next/server";

import { fetchCorporativoLookups } from "@/lib/repositories/clienteCorporativo";

export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchCorporativoLookups();
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar lookups corporativo", error);
    return NextResponse.json({ error: "Erro ao carregar dados do formulário." }, { status: 500 });
  }
}
