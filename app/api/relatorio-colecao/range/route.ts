import { NextResponse } from "next/server";

import { fetchCollectionReportAvailableRange } from "@/lib/repositories/collectionReport";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const colecoes = searchParams.getAll("colecao");

  try {
    const data = await fetchCollectionReportAvailableRange({
      company,
      filial: filial || null,
      colecoes: colecoes.length > 0 ? colecoes : null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar range do relatorio de colecao", error);
    return NextResponse.json(
      { error: "Erro ao carregar range do relatorio de colecao." },
      { status: 500 }
    );
  }
}
