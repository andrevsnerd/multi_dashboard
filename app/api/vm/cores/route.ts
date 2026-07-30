import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { resolverNomeFilial } from "@/lib/repositories/ajusteEstoque";
import { escopoPermiteFilial, resolveVmEscopo } from "@/lib/server/vm-escopo";
import { fetchVmCoresDisponiveis } from "@/lib/server/vm-movimento";
import { isVmCompany } from "@/lib/utils/vm";

export const dynamic = "force-dynamic";

/**
 * Cores do produto COM estoque na filial escolhida. A cor é obrigatória no VM, então a
 * página escolhe daqui — o que já impede marcar uma peça que não existe na loja.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = resolveCompany(searchParams.get("company") ?? "");
  const filial = (searchParams.get("filial") ?? "").trim();
  const produto = (searchParams.get("produto") ?? "").trim();

  if (!company) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }
  if (!isVmCompany(company.key)) {
    return NextResponse.json(
      { error: "A lista de VM está disponível apenas para NERD por enquanto." },
      { status: 400 }
    );
  }
  if (!filial || !produto) {
    return NextResponse.json({ error: "Informe a filial e o produto." }, { status: 400 });
  }

  const { escopo, error } = await resolveVmEscopo(request.headers.get("x-auth-username"));
  if (error) return error;

  if (!escopoPermiteFilial(escopo, filial)) {
    return NextResponse.json({ error: "Você não tem acesso a essa filial." }, { status: 403 });
  }

  try {
    const filialNome = await resolverNomeFilial(filial);
    if (!filialNome) {
      return NextResponse.json({ error: "Filial não encontrada." }, { status: 404 });
    }

    const data = await fetchVmCoresDisponiveis(filialNome, produto);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[vm/cores] erro", cause);
    return NextResponse.json({ error: "Erro ao carregar as cores do produto." }, { status: 500 });
  }
}
