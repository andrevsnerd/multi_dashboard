import { NextResponse } from "next/server";

import { fetchComparativoColecoes } from "@/lib/repositories/comparativoColecoes";

export const maxDuration = 300;

type RequestBody = {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
  colecoes?: Array<{ code?: string; label?: string }>;
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
      { error: "Gerador de Apresentações disponível apenas para ScarfMe." },
      { status: 400 }
    );
  }

  const colecoes = (body.colecoes ?? [])
    .map((c) => ({ code: (c.code ?? "").trim(), label: c.label }))
    .filter((c) => c.code);

  if (colecoes.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma coleção." }, { status: 400 });
  }

  if (!body.range?.start || !body.range?.end) {
    return NextResponse.json({ error: "Informe o período (início e fim)." }, { status: 400 });
  }

  try {
    const data = await fetchComparativoColecoes({
      company: body.company,
      filial: body.filial ?? null,
      range: { start: body.range.start, end: body.range.end },
      colecoes,
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao gerar comparativo de coleções", error);
    return NextResponse.json({ error: "Erro ao gerar o comparativo." }, { status: 500 });
  }
}
