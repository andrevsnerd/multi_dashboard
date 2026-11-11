import { NextResponse } from "next/server";

import { autorizarPrecos, parsePrecoCompany } from "@/lib/auth/precos-guard";
import { canEditarMetaPainel } from "@/lib/auth/permissions";
import { getMetaPainel, saveMetaPainel } from "@/lib/utils/metas-paineis-store";

export const dynamic = "force-dynamic";

/** Ano da campanha: "2026". */
const anoValido = (v: unknown): v is string => typeof v === "string" && /^\d{4}$/.test(v);

/**
 * Meta GERAL da Black Friday (R$ da venda dos itens da Black), uma por empresa e ano.
 * GET ?company=&ano= · POST { company, ano, valor } (valor 0 apaga).
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  const params = new URL(request.url).searchParams;
  const company = parsePrecoCompany(params.get("company"));
  const ano = params.get("ano");
  if (!company || !anoValido(ano)) {
    return NextResponse.json({ error: "Parâmetros company e ano são obrigatórios." }, { status: 400 });
  }

  try {
    const meta = await getMetaPainel(company, "black-friday", ano);
    return NextResponse.json({ data: meta }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao ler a meta da Black Friday", error);
    return NextResponse.json({ error: "Erro ao ler a meta." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Meta não é operação de preço: diretor grava (somente-leitura no resto).
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;
  if (!canEditarMetaPainel(autorizacao.auth.role)) {
    return NextResponse.json({ error: "Esta função não pode alterar a meta." }, { status: 403 });
  }

  let body: { company?: string; ano?: string; valor?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const company = parsePrecoCompany(body.company);
  if (!company || !anoValido(body.ano)) {
    return NextResponse.json({ error: "Empresa ou ano inválido." }, { status: 400 });
  }
  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "Meta inválida." }, { status: 400 });
  }

  try {
    const meta = await saveMetaPainel({
      company,
      escopo: "black-friday",
      chave: body.ano,
      valor,
      usuario: autorizacao.auth.username,
    });
    return NextResponse.json({ data: meta }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao salvar a meta da Black Friday", error);
    const message = error instanceof Error ? error.message : "Erro ao salvar a meta.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
