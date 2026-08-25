/**
 * Ponte Compras Salvas → Gastos de Compra.
 *
 * Uma Compra Salva já é a lista real do que foi comprado (produto × cor × qtd ×
 * custo) e já carrega a data em que foi fechada. Então ela é reconhecida como
 * compra do painel sem redigitação: valor vem de `qtd × custo` item por item e a
 * data da compra vem do `savedAt`.
 *
 * Item sem custo cadastrado nunca soma zero escondido — quem consome marca o
 * lote como estimativa e registra quantos ficaram de fora.
 */

import { fetchCustosPorProdutos } from "@/lib/repositories/controleEstoque";
import type { CompraGastoCandidata, CompraGastoItem } from "@/lib/types/compra-gasto";
import type { CompraSalva, CompraSalvaItemRow } from "@/lib/types/compra-salva";
import { cents, itensTotal } from "@/lib/utils/compra-gastos-agregacao";
import { getCompraSalva, listComprasSalvasFull } from "@/lib/utils/compra-salva-store";

/** Mesmo contrato que a tela consome (o tipo vive em lib/types para não puxar este módulo, que depende do driver do SQL Server, para o cliente). */
export type CompraSalvaMaterializada = CompraGastoCandidata;

/**
 * `savedAt` é ISO em UTC. Converter fatiando a string direto erra o dia para
 * qualquer registro salvo depois das 21h de Brasília.
 */
export function dataBrasiliaDe(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 10);
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function itemDaCompraSalva(row: CompraSalvaItemRow, custoMap: Map<string, number>): CompraGastoItem {
  const custo =
    row.custoUnitario && row.custoUnitario > 0
      ? row.custoUnitario
      : custoMap.get((row.produto ?? "").trim()) ?? 0;
  return {
    descricao: row.descricao || row.produto,
    produto: row.produto,
    corProduto: row.corProduto ?? null,
    corDescricao: row.corDescricao ?? null,
    qtd: Math.max(0, Math.round(row.qtdManual ?? 0)),
    custoUnitario: custo,
  };
}

/** Busca no ERP o custo dos itens que não têm custo salvo. Falha do ERP não derruba nada. */
async function custosFaltantes(compras: CompraSalva[]): Promise<Map<string, number>> {
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

function materializar(compra: CompraSalva, custoMap: Map<string, number>): CompraSalvaMaterializada {
  const itens = compra.items.map((row) => itemDaCompraSalva(row, custoMap));
  return {
    compraSalvaId: compra.id,
    titulo: compra.title,
    dataCompra: dataBrasiliaDe(compra.savedAt),
    itens,
    total: itensTotal(itens),
    itemCount: itens.length,
    semCusto: itens.filter((i) => !(i.custoUnitario > 0)).length,
    comprada: !!compra.comprada,
  };
}

/** Materializa UMA Compra Salva. `null` quando ela não existe na empresa. */
export async function materializarCompraSalva(
  companyKey: string,
  compraSalvaId: string
): Promise<CompraSalvaMaterializada | null> {
  const compra = await getCompraSalva(companyKey, compraSalvaId);
  if (!compra) return null;
  const custoMap = await custosFaltantes([compra]);
  return materializar(compra, custoMap);
}

export type EscopoReconhecimento = "comprada" | "todas";

/**
 * Compras Salvas que ainda NÃO foram lançadas no painel.
 *
 * `escopo` padrão "comprada" usa a marcação de comprada da tela de Compras
 * Salvas como sinal de "essa virou compra de verdade" — sem isso a lista traria
 * todo snapshot de Lista Loja. "todas" mostra o resto para os casos em que a
 * marcação não foi feita.
 */
export async function listarCandidatasReconhecimento(
  companyKey: string,
  jaLancados: Set<string>,
  escopo: EscopoReconhecimento = "comprada"
): Promise<CompraSalvaMaterializada[]> {
  const todas = await listComprasSalvasFull(companyKey);
  const pendentes = todas
    .filter((c) => !jaLancados.has(c.id))
    .filter((c) => (escopo === "comprada" ? !!c.comprada : true));

  if (pendentes.length === 0) return [];

  const custoMap = await custosFaltantes(pendentes);
  return pendentes
    .map((c) => materializar(c, custoMap))
    .filter((m) => m.itemCount > 0)
    .sort((a, b) => b.dataCompra.localeCompare(a.dataCompra));
}

/**
 * Observação de import: registra o que ficou sem custo em vez de deixar o valor
 * mentir. Devolve `null` quando não há nada a avisar.
 */
export function avisoDeCustoFaltante(m: CompraSalvaMaterializada): string | null {
  if (m.semCusto <= 0) return null;
  return `${m.semCusto} de ${m.itemCount} itens sem custo cadastrado — valor subestimado.`;
}

/** Valor da compra reconhecida, já em centavos fechados. */
export function totalDaMaterializada(m: CompraSalvaMaterializada): number {
  return cents(m.total);
}

/** Junta observação existente e aviso automático em linhas separadas. */
export function combinarObservacao(...partes: (string | null | undefined)[]): string | null {
  const texto = partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(String.fromCharCode(10));
  return texto || null;
}
