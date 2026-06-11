import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import {
  deleteProdutoDescontinuado,
  listProdutosDescontinuados,
  saveProdutoDescontinuado,
} from "@/lib/utils/produto-descontinuado-store";

function getCompany(searchParams: URLSearchParams): CompanyKey | null {
  const company = searchParams.get("company");
  return company === "nerd" || company === "scarfme" ? company : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = getCompany(searchParams);

  if (!company) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await listProdutosDescontinuados(company);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao listar produtos descontinuados", error);
    return NextResponse.json({ error: "Erro ao listar produtos descontinuados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: {
    company?: CompanyKey;
    produto?: string;
    descricao?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const company = body.company;
  if (company !== "nerd" && company !== "scarfme") {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await saveProdutoDescontinuado({
      company,
      produto: body.produto ?? "",
      descricao: body.descricao ?? undefined,
    });

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar produto descontinuado.";
    const status = error instanceof Error ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = getCompany(searchParams);
  const produto = searchParams.get("produto") ?? "";

  if (!company) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  if (!produto.trim()) {
    return NextResponse.json({ error: "Parâmetro produto é obrigatório." }, { status: 400 });
  }

  try {
    const removed = await deleteProdutoDescontinuado(company, produto);
    return NextResponse.json({ removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao excluir produto descontinuado", error);
    return NextResponse.json({ error: "Erro ao excluir produto descontinuado." }, { status: 500 });
  }
}
