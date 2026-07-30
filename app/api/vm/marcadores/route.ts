import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { listVmItems } from "@/lib/utils/vm-store";
import { isVmCompany } from "@/lib/utils/vm";

export const dynamic = "force-dynamic";

/**
 * Marcadores de VM para as telas de análise: só o suficiente para uma etiqueta.
 *
 * Diferente de `/api/vm`, esta rota NÃO exige a permissão da página de VM — quem olha
 * Estoque por Filial ou Lista Loja precisa saber que existe uma peça em exposição ali,
 * mesmo sem poder mexer na lista. É leitura, sem custo e sem dado sensível.
 *
 * Empresa sem VM habilitado devolve lista vazia em vez de erro: as telas são
 * compartilhadas entre empresas e não deveriam precisar saber disso.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = resolveCompany(searchParams.get("company") ?? "");

  if (!company) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }
  if (!isVmCompany(company.key)) {
    return NextResponse.json({ data: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const items = await listVmItems(company.key);
    const data = items.map((item) => ({
      filial: item.filial,
      filialNome: item.filialNome,
      produto: item.produto,
      cor: item.cor,
      descCor: item.descCor,
    }));

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[vm/marcadores] erro", cause);
    // Etiqueta é informativa: falha não deve derrubar a tela que a consome.
    return NextResponse.json({ data: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
