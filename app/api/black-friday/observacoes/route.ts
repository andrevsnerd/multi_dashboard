import { NextResponse } from "next/server";

import { autorizarPrecos, parsePrecoCompany } from "@/lib/auth/precos-guard";
import {
  listBlackFridayObservacoes,
  saveBlackFridayObservacao,
} from "@/lib/utils/black-friday-observacoes-store";

export const dynamic = "force-dynamic";

/** Observações por item do painel Black Friday (mesmo funcionamento da Curva ABC). */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  const company = parsePrecoCompany(new URL(request.url).searchParams.get("company"));
  if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  try {
    const data = await listBlackFridayObservacoes(company);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao listar observações da Black Friday", error);
    return NextResponse.json({ error: "Erro ao listar observações." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  let body: { company?: string; produto?: string; cor?: string | null; observacao?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const company = parsePrecoCompany(body.company);
  if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  try {
    const data = await saveBlackFridayObservacao({
      company,
      produto: body.produto ?? "",
      cor: body.cor ?? null,
      observacao: body.observacao ?? "",
      usuario: autorizacao.auth.username,
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao salvar observação da Black Friday", error);
    const message = error instanceof Error ? error.message : "Erro ao salvar observação.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
