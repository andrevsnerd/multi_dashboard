import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import {
  deleteProdutoAgrupadoGroup,
  listProdutoAgrupadoGroups,
  saveProdutoAgrupadoGroup,
} from "@/lib/utils/produto-agrupado-store";

function getCompany(searchParams: URLSearchParams): CompanyKey | null {
  const company = searchParams.get("company");
  return company === "nerd" || company === "scarfme" ? company : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = getCompany(searchParams);

  if (!company) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await listProdutoAgrupadoGroups(company);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao listar produtos agrupados", error);
    return NextResponse.json({ error: "Erro ao listar produtos agrupados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: {
    company?: CompanyKey;
    groupId?: string | null;
    nome?: string;
    members?: Array<{
      produto?: string;
      cor?: string | null;
      descricao?: string | null;
      corDescricao?: string | null;
    }>;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const company = body.company;
  if (company !== "nerd" && company !== "scarfme") {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  try {
    const data = await saveProdutoAgrupadoGroup({
      company,
      groupId: body.groupId ?? null,
      nome: body.nome ?? "",
      members: (body.members ?? []).map((member) => ({
        produto: member.produto,
        cor: member.cor ?? undefined,
        descricao: member.descricao ?? undefined,
        corDescricao: member.corDescricao ?? undefined,
      })),
    });

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar produto agrupado.";
    const status = error instanceof Error ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = getCompany(searchParams);
  const groupId = searchParams.get("groupId") ?? "";

  if (!company) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório." }, { status: 400 });
  }

  if (!groupId.trim()) {
    return NextResponse.json({ error: "Parâmetro groupId é obrigatório." }, { status: 400 });
  }

  try {
    const removed = await deleteProdutoAgrupadoGroup(company, groupId);
    return NextResponse.json({ removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao excluir produto agrupado", error);
    return NextResponse.json({ error: "Erro ao excluir produto agrupado." }, { status: 500 });
  }
}
