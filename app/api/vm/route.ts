import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { listarFiliaisDoEscopo, resolveVmEscopo } from "@/lib/server/vm-escopo";
import { listVmItems, listVmMovimentos } from "@/lib/utils/vm-store";
import { isVmCompany } from "@/lib/utils/vm";

export const dynamic = "force-dynamic";

/**
 * Estado da página VM: escopo do usuário, filiais que ele pode operar, peças em VM e os
 * últimos movimentos. Uma chamada só — a página precisa dos quatro juntos para montar.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = resolveCompany(searchParams.get("company") ?? "");

  if (!company) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }
  if (!isVmCompany(company.key)) {
    return NextResponse.json(
      { error: "A lista de VM está disponível apenas para NERD por enquanto." },
      { status: 400 }
    );
  }

  const { escopo, error } = await resolveVmEscopo(request.headers.get("x-auth-username"));
  if (error) return error;

  try {
    const filiais = await listarFiliaisDoEscopo(company.key, escopo);
    const filiaisEscopo = escopo.todasFiliais ? null : filiais.map((f) => f.cod);

    const [items, movimentos] = await Promise.all([
      listVmItems(company.key, filiaisEscopo),
      listVmMovimentos(company.key, { filiais: filiaisEscopo, limit: 60 }),
    ]);

    return NextResponse.json(
      {
        escopo: {
          username: escopo.username,
          role: escopo.role,
          todasFiliais: escopo.todasFiliais,
          podeMutar: escopo.podeMutar,
        },
        filiais,
        items,
        movimentos,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (cause) {
    console.error("[vm] erro ao carregar estado", cause);
    return NextResponse.json({ error: "Erro ao carregar a lista de VM." }, { status: 500 });
  }
}
