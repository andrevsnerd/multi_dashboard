import { NextResponse } from "next/server";

import { fetchDistribuicaoMatriz } from "@/lib/repositories/distribuicaoMatriz";
import { resolveCompany } from "@/lib/config/company";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companySlug = searchParams.get("company") ?? undefined;
  const company = resolveCompany(companySlug);

  if (!company) {
    return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
  }

  try {
    const data = await fetchDistribuicaoMatriz(company.key);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar distribuição da matriz", error);
    return NextResponse.json({ error: "Erro ao carregar distribuição da matriz" }, { status: 500 });
  }
}
