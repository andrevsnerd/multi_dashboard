import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import { fetchNecessidadeAviamentos } from "@/lib/repositories/projecaoAviamentos";
import {
  carregarEstoqueAviamentos,
  salvarEstoqueAviamentos,
} from "@/lib/utils/aviamentos-estoque-store";

export const maxDuration = 300;

/**
 * Necessidade de AVIAMENTO: quanto de cada etiqueta/tag/lâmina as peças compradas e ainda
 * não chegadas vão consumir, mais o estoque digitado de cada aviamento.
 *
 * A tela é a aba "Aviamentos" da Projeção Compra. Não há data base nem filial: a base é o
 * trânsito da empresa inteira — ver [projecaoAviamentos.ts](@/lib/repositories/projecaoAviamentos).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company");

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  // As regras de aviamento são as da ScarfMe.
  if (companyKey !== "scarfme") {
    return NextResponse.json(
      { error: "A necessidade de aviamentos hoje só existe para a Scarf Me." },
      { status: 400 }
    );
  }

  try {
    const [necessidade, estoque] = await Promise.all([
      fetchNecessidadeAviamentos(companyKey),
      carregarEstoqueAviamentos(companyKey),
    ]);

    return NextResponse.json(
      { ...necessidade, estoque },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro em /api/projecao-aviamentos:", error);
    return NextResponse.json({ error: "Erro ao calcular a necessidade de aviamentos" }, { status: 500 });
  }
}

/** Salva o estoque digitado dos aviamentos (aceita só as linhas alteradas). */
export async function PUT(request: Request) {
  try {
    const usuario = request.headers.get("x-auth-username") ?? "";
    const bloqueado = await readOnlyBlock(usuario);
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as { company?: string; estoque?: unknown };
    const company = String(body?.company ?? "").trim();
    if (company !== "scarfme") {
      return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
    }

    const estoque = await salvarEstoqueAviamentos(company, body?.estoque ?? {}, usuario);
    return NextResponse.json({ estoque });
  } catch (error) {
    console.error("Erro ao salvar estoque de aviamentos:", error);
    return NextResponse.json({ error: "Erro ao salvar o estoque" }, { status: 500 });
  }
}
