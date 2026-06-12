import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import {
  buildReconciliacaoResposta,
  reconcileCompanyCompras,
} from "@/lib/server/compra-transito-reconciliacao";
import { getCompraTransito } from "@/lib/utils/compra-transito-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get("company") ?? "") as CompanyKey;
  const { id } = await params;

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }

  try {
    const { confirmed, recMap } = await reconcileCompanyCompras(companyKey);

    const target =
      confirmed.find((c) => c.id === id) ?? (await getCompraTransito(companyKey, id));
    if (!target) {
      return NextResponse.json(
        { error: "Compra em trânsito não encontrada" },
        { status: 404 }
      );
    }

    const data = buildReconciliacaoResposta(target, recMap.get(id) ?? new Map());
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao reconciliar compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao reconciliar compra em trânsito" },
      { status: 500 }
    );
  }
}
