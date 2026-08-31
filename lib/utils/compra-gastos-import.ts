/**
 * Ponte Compras em trânsito → Gastos de Compra.
 *
 * A compra que o painel financeiro reconhece é a Compra em trânsito CONFIRMADA:
 * ela é a única lista que representa mercadoria que já foi de fato comprada e
 * está vindo (produto × cor × qtd × custo, com data de recebimento por item).
 * Rascunho não é compra — é lista sendo montada — e por isso nunca entra aqui.
 *
 * Nada é redigitado: o valor vem de `qtd × custo` item por item, a data da
 * compra é o dia em que o trânsito foi confirmado e a previsão de chegada é a
 * menor data de recebimento dos itens.
 *
 * Item sem custo cadastrado nunca soma zero escondido — quem consome marca o
 * lote como estimativa e registra quantos ficaram de fora.
 */

import { fetchCustosPorProdutos } from "@/lib/repositories/controleEstoque";
import type { CompraGastoCandidata, CompraGastoItem } from "@/lib/types/compra-gasto";
import type { CompraTransito, CompraTransitoItemRow } from "@/lib/types/compra-transito";
import { itensTotal } from "@/lib/utils/compra-gastos-agregacao";
import { getCompraTransito } from "@/lib/utils/compra-transito-store";

/** Mesmo contrato que a tela consome (o tipo vive em lib/types para não puxar este módulo, que depende do driver do SQL Server, para o cliente). */
export type CompraTransitoMaterializada = CompraGastoCandidata;

/**
 * Timestamps são ISO em UTC. Converter fatiando a string direto erra o dia para
 * qualquer registro criado depois das 21h de Brasília.
 */
export function dataBrasiliaDe(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 10);
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function itemDaCompraTransito(
  row: CompraTransitoItemRow,
  custoMap: Map<string, number>
): CompraGastoItem {
  const custo =
    row.custoUnitario && row.custoUnitario > 0
      ? row.custoUnitario
      : custoMap.get((row.produto ?? "").trim()) ?? 0;
  return {
    descricao: row.descricao || row.produto,
    produto: row.produto,
    corProduto: row.corProduto ?? null,
    corDescricao: row.corDescricao ?? null,
    qtd: Math.max(0, Math.round(row.quantidade ?? 0)),
    custoUnitario: custo,
  };
}

/** Busca no ERP o custo dos itens que não têm custo salvo. Falha do ERP não derruba nada. */
async function custosFaltantes(compras: CompraTransito[]): Promise<Map<string, number>> {
  const produtos = [
    ...new Set(
      compras
        .flatMap((c) => c.items)
        .filter((i) => !(i.custoUnitario && i.custoUnitario > 0))
        .map((i) => (i.produto ?? "").trim())
        .filter(Boolean)
    ),
  ];
  if (produtos.length === 0) return new Map();
  try {
    return await fetchCustosPorProdutos(produtos);
  } catch {
    // ERP fora do ar: os itens ficam sem custo e o chamador marca estimativa.
    return new Map();
  }
}

/** Menor data de recebimento preenchida dos itens — a previsão de chegada da compra. */
function previsaoChegadaDe(items: CompraTransitoItemRow[]): string | null {
  const datas = items
    .map((item) => (item.dataRecebimento ?? "").trim().slice(0, 10))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return datas[0] ?? null;
}

function materializar(
  compra: CompraTransito,
  custoMap: Map<string, number>
): CompraTransitoMaterializada {
  const itens = compra.items.map((row) => itemDaCompraTransito(row, custoMap));
  return {
    compraTransitoId: compra.id,
    titulo: compra.title,
    // A compra existe a partir do momento em que foi confirmada em trânsito.
    dataCompra: dataBrasiliaDe(compra.confirmedAt),
    itens,
    total: itensTotal(itens),
    itemCount: itens.length,
    totalQuantidade: itens.reduce((s, i) => s + i.qtd, 0),
    semCusto: itens.filter((i) => !(i.custoUnitario > 0)).length,
    status: compra.status,
    previsaoChegada: previsaoChegadaDe(compra.items),
  };
}

/** Materializa UMA Compra em trânsito. `null` quando ela não existe na empresa. */
export async function materializarCompraTransito(
  companyKey: string,
  compraTransitoId: string
): Promise<CompraTransitoMaterializada | null> {
  const compra = await getCompraTransito(companyKey, compraTransitoId);
  if (!compra) return null;
  const custoMap = await custosFaltantes([compra]);
  return materializar(compra, custoMap);
}

/**
 * Observação de import: registra o que ficou sem custo em vez de deixar o valor
 * mentir. Devolve `null` quando não há nada a avisar.
 */
export function avisoDeCustoFaltante(m: CompraTransitoMaterializada): string | null {
  if (m.semCusto <= 0) return null;
  return `${m.semCusto} de ${m.itemCount} itens sem custo cadastrado — valor subestimado.`;
}


/** Junta observação existente e aviso automático em linhas separadas. */
export function combinarObservacao(...partes: (string | null | undefined)[]): string | null {
  const texto = partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(String.fromCharCode(10));
  return texto || null;
}
