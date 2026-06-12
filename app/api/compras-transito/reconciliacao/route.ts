import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import type { CompraTransitoReconciliacaoResposta } from "@/lib/types/compra-transito";
import {
  buildReconciliacaoResposta,
  reconcileCompanyCompras,
} from "@/lib/server/compra-transito-reconciliacao";

/**
 * Reconciliação em LOTE: devolve só o resumo (status geral + contagens) de cada
 * compra confirmada da empresa, para colorir os cards da lista pelo status real.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get("company") ?? "") as CompanyKey;

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }

  try {
    const { confirmed, recMap } = await reconcileCompanyCompras(companyKey);

    const data: Record<string, CompraTransitoReconciliacaoResposta["resumo"]> = {};
    for (const compra of confirmed) {
      data[compra.id] = buildReconciliacaoResposta(compra, recMap.get(compra.id) ?? new Map()).resumo;
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao reconciliar lista de compras em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao reconciliar lista de compras em trânsito" },
      { status: 500 }
    );
  }
}
