import { NextResponse } from "next/server";

import { fetchCollectionReport } from "@/lib/repositories/collectionReport";

export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const colecoes = searchParams.getAll("colecao");

  if (!start || !end) {
    return NextResponse.json(
      { error: "Parametros start e end sao obrigatorios." },
      { status: 400 }
    );
  }

  try {
    const data = await fetchCollectionReport({
      company,
      filial: filial || null,
      range: { start, end },
      colecoes: colecoes.length > 0 ? colecoes : null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar relatorio de colecao", error);
    return NextResponse.json(
      { error: "Erro ao carregar relatorio de colecao." },
      { status: 500 }
    );
  }
}
