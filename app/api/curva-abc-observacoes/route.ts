import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import {
  listCurvaAbcObservacoes,
  saveCurvaAbcObservacao,
} from "@/lib/utils/curva-abc-observacoes-store";

function isCompanyKey(value: unknown): value is CompanyKey {
  return value === "nerd" || value === "scarfme";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company");

  if (!isCompanyKey(company)) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await listCurvaAbcObservacoes(company);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao listar observações da Curva ABC", error);
    return NextResponse.json({ error: "Erro ao listar observações da Curva ABC." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: {
    company?: CompanyKey;
    produto?: string;
    cor?: string | null;
    observacao?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  if (!isCompanyKey(body.company)) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await saveCurvaAbcObservacao({
      company: body.company,
      produto: body.produto ?? "",
      cor: body.cor ?? null,
      observacao: body.observacao ?? "",
    });

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar observação.";
    const status = error instanceof Error ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
