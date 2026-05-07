import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { syncProdutoNovoLabels } from "@/lib/repositories/produtosNovos";

export const maxDuration = 60;

function resolveCompanyFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  return resolveCompany(searchParams.get("company") || undefined);
}

export async function GET(request: Request) {
  const company = resolveCompanyFromRequest(request);

  if (!company) {
    return NextResponse.json({ error: "Empresa invalida" }, { status: 400 });
  }

  try {
    const data = await syncProdutoNovoLabels(company.key);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao sincronizar labels de produtos novos", error);
    return NextResponse.json(
      { error: "Erro ao sincronizar labels de produtos novos" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
