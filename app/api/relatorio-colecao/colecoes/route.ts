import { NextResponse } from "next/server";

import { fetchCollectionReportColecoes } from "@/lib/repositories/collectionReport";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  try {
    const data = await fetchCollectionReportColecoes({
      company,
      filial: filial || null,
      range: start && end ? { start, end } : undefined,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar colecoes do relatorio", error);
    return NextResponse.json(
      { error: "Erro ao carregar colecoes do relatorio." },
      { status: 500 }
    );
  }
}
