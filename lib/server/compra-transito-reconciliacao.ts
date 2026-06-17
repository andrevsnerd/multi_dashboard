import "server-only";

import type { CompanyKey } from "@/lib/config/company";
import type {
  CompraTransito,
  CompraTransitoReconciliacaoResposta,
} from "@/lib/types/compra-transito";
import {
  fetchMatrizEntriesByColor,
  matrizNameForCompany,
} from "@/lib/repositories/comprasTransitoReconciliacao";
import {
  reconcileCompras,
  type ItemReconciliacao,
} from "@/lib/utils/compra-transito-reconciliacao";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";

/**
 * Reconcilia TODAS as compras confirmadas de uma empresa contra as entradas reais
 * na matriz, de uma vez (o FIFO entre compras exige o conjunto completo). Tanto o
 * detalhe (uma compra) quanto a lista (todas) usam este mesmo cálculo.
 */
export async function reconcileCompanyCompras(companyKey: CompanyKey): Promise<{
  confirmed: CompraTransito[];
  recMap: Map<string, Map<string, ItemReconciliacao>>;
}> {
  const all = await listComprasTransitoFull(companyKey);
  const confirmed = all.filter((c) => c.status !== "rascunho");

  const produtos = Array.from(
    new Set(confirmed.flatMap((c) => c.items.map((i) => i.produto)).filter(Boolean))
  );

  // Corte = data da compra mais antiga (confirmação); nenhuma entrada anterior à
  // compra mais velha pode ser alocada. Usa confirmedAt (data real do pedido), não
  // createdAt — um rascunho pode ter sido criado bem antes de a compra existir.
  const cutoff = confirmed.reduce<string>((min, c) => {
    const day = (c.confirmedAt ?? "").slice(0, 10);
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
      // Data da compra = confirmação real do pedido (mesma data exibida na UI),
      // não a criação do rascunho. Entradas anteriores a ela não a preenchem.
      dataCompra: c.confirmedAt,
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

  return { confirmed, recMap };
}

/** Monta os itens reconciliados + o resumo (status geral) de UMA compra. */
export function buildReconciliacaoResposta(
  compra: CompraTransito,
  itensRec: Map<string, ItemReconciliacao>
): CompraTransitoReconciliacaoResposta {
  const itens: CompraTransitoReconciliacaoResposta["itens"] = {};
  let recebidos = 0;
  let parciais = 0;
  let atrasados = 0;
  let emTransito = 0;

  for (const item of compra.items) {
    const rec = itensRec.get(item.itemKey);
    if (!rec) continue;
    itens[item.itemKey] = rec;
    if (rec.statusReal === "recebido") recebidos += 1;
    else if (rec.statusReal === "parcial") parciais += 1;
    else if (rec.statusReal === "atrasado") atrasados += 1;
    else if (rec.statusReal === "em_transito") emTransito += 1;
  }

  // "recebido" só quando TODOS os itens chegaram por completo. Enquanto faltar
  // algo, a compra não fica recebida — fica parcial (amarela), depois atrasada.
  const totalItens = compra.items.length;
  let statusGeral: CompraTransitoReconciliacaoResposta["resumo"]["statusGeral"] = "em_transito";
  if (totalItens > 0 && recebidos === totalItens) statusGeral = "recebido";
  else if (parciais > 0) statusGeral = "parcial";
  else if (atrasados > 0) statusGeral = "atrasado";

  return {
    compraId: compra.id,
    itens,
    resumo: { totalItens, recebidos, parciais, atrasados, emTransito, statusGeral },
  };
}
