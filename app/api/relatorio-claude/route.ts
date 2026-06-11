import { NextResponse } from "next/server";

import { fetchClaudeReport } from "@/lib/repositories/claudeReport";

export const maxDuration = 300;

type RequestBody = {
  company?: string;
  filial?: string | null;
  colecoes?: string[];
  subgrupos?: string[];
  grupos?: string[];
  grades?: string[];
  ranges?: Array<{
    start?: string;
    end?: string;
  }>;
};

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalido." }, { status: 400 });
  }

  if (body.company !== "scarfme") {
    return NextResponse.json(
      { error: "Relatorio Claude disponivel apenas para ScarfMe." },
      { status: 400 }
    );
  }

  const ranges = Array.isArray(body.ranges)
    ? body.ranges.filter((range) => range?.start && range?.end)
    : [];

  if (ranges.length === 0) {
    return NextResponse.json(
      { error: "Informe pelo menos um range valido." },
      { status: 400 }
    );
  }

  try {
    const data = await Promise.all(
      ranges.map((range) =>
        fetchClaudeReport({
          filial: body.filial ?? null,
          range,
          colecoes: body.colecoes ?? [],
          subgrupos: body.subgrupos ?? [],
          grupos: body.grupos ?? [],
          grades: body.grades ?? [],
        })
      )
    );

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao carregar Relatorio Claude", error);
    return NextResponse.json(
      { error: "Erro ao carregar Relatorio Claude." },
      { status: 500 }
    );
  }
}
