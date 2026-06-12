import { NextResponse } from "next/server";

import type { CompanyKey } from "@/lib/config/company";
import type {
  CompraTransitoReconciliacaoResposta,
  CompraTransitoStatusReal,
} from "@/lib/types/compra-transito";
import {
  fetchMatrizEntriesByColor,
  matrizNameForCompany,
} from "@/lib/repositories/comprasTransitoReconciliacao";
import { reconcileCompras } from "@/lib/utils/compra-transito-reconciliacao";
import { getCompraTransito, listComprasTransitoFull } from "@/lib/utils/compra-transito-store";

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
    const target = await getCompraTransito(companyKey, id);
    if (!target) {
      return NextResponse.json(
        { error: "Compra em trânsito não encontrada" },
        { status: 404 }
      );
    }

    // FIFO correto exige TODAS as compras confirmadas da empresa (anti-roubo entre
    // compras), não só a aberta. Rascunhos ficam de fora da alocação.
    const all = await listComprasTransitoFull(companyKey);
    const confirmed = all.filter((c) => c.status !== "rascunho");

    const produtos = Array.from(
      new Set(confirmed.flatMap((c) => c.items.map((i) => i.produto)).filter(Boolean))
    );

    // Corte = dia da compra mais antiga; nenhuma entrada anterior a isso pode ser
    // alocada a qualquer compra (a elegibilidade por compra é refinada no util).
    const cutoff = confirmed.reduce<string>((min, c) => {
      const day = (c.createdAt ?? "").slice(0, 10);
      return !min || (day && day < min) ? day || min : min;
    }, "");

    const matrizName = await matrizNameForCompany(companyKey);

    const entries =
      matrizName && produtos.length && cutoff
        ? await fetchMatrizEntriesByColor(produtos, matrizName, cutoff)
        : [];

    const recMap = reconcileCompras({
      compras: confirmed.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        items: c.items.map((i) => ({
          itemKey: i.itemKey,
          produto: i.produto,
          corProduto: i.corProduto,
          quantidade: i.quantidade,
          dataRecebimento: i.dataRecebimento,
        })),
      })),
      entries: entries.map((e) => ({
        produto: e.produto,
        corProduto: e.corProduto,
        dataEntrada: e.dataEntrada,
        qtde: e.qtde,
        romaneio: e.romaneio,
        responsavel: e.responsavel,
        custoUnitario: e.custoUnitario,
      })),
    });

    const itensRec = recMap.get(id) ?? new Map();
    const itens: CompraTransitoReconciliacaoResposta["itens"] = {};
    let recebidos = 0;
    let atrasados = 0;
    let emTransito = 0;

    for (const item of target.items) {
      const rec = itensRec.get(item.itemKey);
      if (!rec) continue;
      itens[item.itemKey] = rec;
      if (rec.statusReal === "recebido") recebidos += 1;
      else if (rec.statusReal === "atrasado") atrasados += 1;
      else if (rec.statusReal === "em_transito") emTransito += 1;
    }

    const totalItens = target.items.length;
    let statusGeral: CompraTransitoStatusReal = "em_transito";
    if (totalItens > 0 && recebidos === totalItens) statusGeral = "recebido";
    else if (atrasados > 0) statusGeral = "atrasado";

    const data: CompraTransitoReconciliacaoResposta = {
      compraId: id,
      itens,
      resumo: { totalItens, recebidos, atrasados, emTransito, statusGeral },
    };

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao reconciliar compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao reconciliar compra em trânsito" },
      { status: 500 }
    );
  }
}
