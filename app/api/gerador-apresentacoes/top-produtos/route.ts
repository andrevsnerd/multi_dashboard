import { NextResponse } from "next/server";

import { fetchTopProdutosPresentation } from "@/lib/repositories/topProdutosPresentation";

export const maxDuration = 300;

type RequestBody = {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  if (body.company !== "scarfme") {
    return NextResponse.json(
      { error: "Top Produtos disponível apenas para ScarfMe." },
      { status: 400 }
    );
  }

  if (!body.range?.start || !body.range?.end) {
    return NextResponse.json({ error: "Informe o período (início e fim)." }, { status: 400 });
  }

  try {
    const data = await fetchTopProdutosPresentation({
      company: body.company,
      filial: body.filial ?? null,
      range: { start: body.range.start, end: body.range.end },
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao gerar apresentação de top produtos", error);
    return NextResponse.json({ error: "Erro ao gerar a apresentação." }, { status: 500 });
  }
}
