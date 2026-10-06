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
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";

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

/** Reconciliação em andamento por empresa — chamadas paralelas compartilham a mesma consulta. */
const pendentesEmAndamento = new Map<string, Promise<CompraTransito[]>>();

/**
 * Compras em trânsito com o que AINDA FALTA CHEGAR, item a item — a fonte única do
 * trânsito para todas as telas (Compras Salvas, Curva ABC, Lista Loja, Projeção,
 * Loja Raio X, relatórios).
 *
 * Antes cada tela decidia pela DATA PREVISTA (`dataRecebimento >= hoje`): no dia
 * seguinte ao previsto o item sumia de todo lugar, mesmo sem ter chegado nada — e
 * a tela de Compras em Trânsito, que reconcilia contra as entradas reais, mostrava
 * esse mesmo item como "atrasado". Regra do dono: atrasado continua em trânsito.
 *
 * Aqui vale a reconciliação (a mesma da tela): `quantidade` passa a ser o `faltou`
 * (pedido − recebido na matriz). Item recebido por completo sai; parcial conta só o
 * restante; atrasado conta inteiro. A data prevista é mantida — se já passou, quem
 * consome trata como "chega agora".
 *
 * Se o Linx falhar, cai na regra antiga por data (com log), para o trânsito não
 * zerar inteiro em todas as telas.
 */
export async function listComprasTransitoPendentes(companyKey: string): Promise<CompraTransito[]> {
  const emAndamento = pendentesEmAndamento.get(companyKey);
  if (emAndamento) return emAndamento;

  const promise = calcularPendentes(companyKey).finally(() => {
    pendentesEmAndamento.delete(companyKey);
  });
  pendentesEmAndamento.set(companyKey, promise);
  return promise;
}

async function calcularPendentes(companyKey: string): Promise<CompraTransito[]> {
  try {
    const { confirmed, recMap } = await reconcileCompanyCompras(companyKey as CompanyKey);
    const out: CompraTransito[] = [];
    for (const compra of confirmed) {
      const itensRec = recMap.get(compra.id);
      const items = compra.items.flatMap((item) => {
        const pedido = Math.max(0, Math.round(Number(item.quantidade ?? 0)));
        const faltou = itensRec?.get(item.itemKey)?.faltou ?? pedido;
        if (faltou <= 0) return [];
        return [{ ...item, quantidade: faltou, status: "em_transito" as const }];
      });
      if (items.length > 0) out.push({ ...compra, status: "em_transito", items });
    }
    return out;
  } catch (error) {
    console.error(
      "[compra-transito] Reconciliação falhou; trânsito cai na regra por data prevista:",
      error
    );
    const all = await listComprasTransitoFull(companyKey);
    const today = new Date();
    return all
      .filter((c) => c.status !== "rascunho")
      .map((c) => ({
        ...c,
        items: c.items.filter((it) => isCompraTransitoDateActive(it.dataRecebimento, today)),
      }))
      .filter((c) => c.items.length > 0);
  }
}
