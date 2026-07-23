import { NextResponse } from "next/server";

import { fetchProdutoGiroPresentation } from "@/lib/repositories/produtoGiroPresentation";

export const maxDuration = 300;

// Diferente das rotas de coleção (ScarfMe-only), o Giro vale para NERD e ScarfMe.
const ALLOWED_COMPANIES = new Set(["scarfme", "nerd"]);

type RequestBody = {
  company?: string;
  filial?: string | null;
  porCor?: boolean;
  produtoIds?: string[];
  grupos?: string[];
  subgrupos?: string[];
  colecoes?: string[];
  grades?: string[];
  search?: string | null;
  coverTitle?: string;
  range?: { start?: string; end?: string };
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  if (!body.company || !ALLOWED_COMPANIES.has(body.company)) {
    return NextResponse.json(
      { error: "Relatório Giro de Produtos disponível apenas para NERD e ScarfMe." },
      { status: 400 }
    );
  }

  if (!body.range?.start || !body.range?.end) {
    return NextResponse.json({ error: "Informe o período (início e fim)." }, { status: 400 });
  }

  try {
    const data = await fetchProdutoGiroPresentation({
      company: body.company,
      filial: body.filial ?? null,
      porCor: body.porCor !== false,
      produtoIds: body.produtoIds ?? null,
      grupos: body.grupos ?? null,
      subgrupos: body.subgrupos ?? null,
      colecoes: body.colecoes ?? null,
      grades: body.grades ?? null,
      search: body.search ?? null,
      coverTitle: body.coverTitle,
      range: { start: body.range.start, end: body.range.end },
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao gerar apresentação de giro de produtos", error);
    return NextResponse.json({ error: "Erro ao gerar a apresentação." }, { status: 500 });
  }
}
