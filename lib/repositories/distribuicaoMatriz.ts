// Distribuição da Matriz → Lojas — repositório server-side.
//
// Reusa a MESMA pipeline de "Compra sugerida por Curva ABC" (reportCompraSugeridaAbc.ts):
// métricas por loja em lote (`getControleEstoqueMetricasItensBatched`, 1 chamada por loja, nunca
// N+1 por item) + `calcCompraIdealFromResumo` — a fonte única de "quanto uma loja precisa" usada
// em Lista Loja, Curva ABC, Compras Salvas e no Gerador de Relatórios. Assim os números desta
// página (estoque, cobertura, Repor/OK) batem com os das outras telas para o mesmo produto×loja.
//
// A ORIGEM aqui é sempre a Matriz: consultamos a métrica dela como só mais uma "filial" (mesma
// fonte de estoque/vendas), depois aplicamos o rateio puro de distribuicao-matriz.ts.

import { fetchControleTransferencias } from "@/lib/repositories/controleTransferencias";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { getControleEstoqueMetricasItensBatched } from "@/lib/server/controle-estoque-metricas";
import {
  buildControleEstoqueItemKey,
  dedupeControleEstoqueItens,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import { calcCompraIdealFromResumo } from "@/lib/utils/compra-ideal";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";
import { canonicalKey } from "@/lib/reports/keys";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import { isMainMatrizFilial, isBlockedDestinationFilial } from "@/lib/utils/transferencia-regras";
import {
  resolveCompany,
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
  isEcommerceFilial,
  type CompanyKey,
} from "@/lib/config/company";
import {
  montarDistribuicaoItem,
  type DistribuicaoResult,
  type LojaDistribuicaoInput,
} from "@/lib/utils/distribuicao-matriz";
import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";

/** Quantas filiais calcular em paralelo (cada uma já batcheia os itens internamente). */
const FILIAL_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const TRANSIT_DESC_PREFIX = " desc ";

/** Espelha lib/repositories/reportCompraSugeridaAbc.ts: casa trânsito por descrição de cor quando o código diverge. */
function transitDescKey(
  produto: string | null | undefined,
  corProduto: string | null | undefined,
  corDescricao?: string | null
): string | null {
  const doProduto = (corDescricao ?? "").trim();
  const base = doProduto || getMappedColorDescription(corProduto);
  const raw = base
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!raw) return null;
  return `${TRANSIT_DESC_PREFIX}${String(produto ?? "").trim()}||${raw}`;
}

/** Índice de compras em trânsito ativas por (produto × cor canônica) — mesma fonte da Compra Ideal em todo o app. */
async function buildTransitIndex(
  company: string | undefined
): Promise<Map<string, CompraTransitoIndexEntry[]>> {
  const idx = new Map<string, CompraTransitoIndexEntry[]>();
  if (!company) return idx;
  const compras = await listComprasTransitoFull(company).catch(() => []);
  const today = new Date();
  for (const c of compras) {
    for (const it of c.items ?? []) {
      if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
      const entry: CompraTransitoIndexEntry = {
        itemKey: it.itemKey ?? "",
        produto: it.produto,
        corProduto: it.corProduto ?? null,
        quantidade: Number(it.quantidade ?? 0),
        dataRecebimento: it.dataRecebimento,
        title: c.title ?? "",
        confirmedAt: c.confirmedAt ?? "",
      };
      const k = canonicalKey(it.produto, it.corProduto ?? null);
      idx.set(k, [...(idx.get(k) ?? []), entry]);
      const dk = transitDescKey(it.produto, it.corProduto, it.corDescricao);
      if (dk) idx.set(dk, [...(idx.get(dk) ?? []), entry]);
    }
  }
  return idx;
}

function resolveTransit(
  transitIndex: Map<string, CompraTransitoIndexEntry[]>,
  produto: string,
  codigoCor: string | null | undefined,
  corDescricao: string | null | undefined
): CompraTransitoIndexEntry[] {
  let transit = transitIndex.get(canonicalKey(produto, codigoCor ?? null)) ?? [];
  if (transit.length === 0) {
    const dk = transitDescKey(produto, codigoCor, corDescricao);
    if (dk) transit = transitIndex.get(dk) ?? [];
  }
  return transit;
}

type MetricasMap = Record<string, ControleEstoqueItemMetricas>;

/**
 * Monta o board Matriz → Lojas: estoque da Matriz + Compra Ideal de cada loja (mesma fórmula
 * canônica de Lista Loja/Curva ABC) + rateio com piso anti-zero. Últimos 30 dias como janela
 * de referência para o universo de itens (mesma janela do Controle de Transferências).
 */
export async function fetchDistribuicaoMatriz(company: CompanyKey): Promise<DistribuicaoResult> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);

  const network = await fetchControleTransferencias({
    company,
    range: { start: start.toISOString(), end: end.toISOString() },
  });

  const companyCfg = resolveCompany(company);

  // Filiais SEMPRE resolvidas para a canônica ATIVA e deduplicadas (getOperationalFilials) — a
  // MESMA base do Gerador de Compra Sugerida ABC. Isso colapsa grupos de filial (ex.: Morumbi que
  // trocou de CNPJ) numa única coluna, evitando dois "MORUMBI 1" e divergência de estoque/venda.
  const matriz =
    getOperationalFilials(companyCfg, "inventory").find((f) => isMainMatrizFilial(company, f)) ?? null;

  if (!matriz) {
    return { matrizLabel: "Matriz", filiaisDestino: [], filialLabels: {}, itens: [] };
  }

  const matrizLabel = companyCfg ? getFilialLabelForDisplay(companyCfg, matriz) : matriz;

  // Destinos: lojas operacionais de venda, menos Matriz / e-commerce / bloqueadas, ordenadas
  // pela ordem de exibição do app e deduplicadas por rótulo (uma coluna por loja).
  const destinosOrdenados = getOperationalFilials(companyCfg, "sales")
    .filter((f) => !isMainMatrizFilial(company, f))
    .filter((f) => !isBlockedDestinationFilial(f))
    .filter((f) => !isEcommerceFilial(company, f))
    .sort((a, b) => compareFilialDisplayOrder(a, b, companyCfg));

  const filiaisDestino: string[] = [];
  const filialLabels: Record<string, string> = {};
  const labelsVistos = new Set<string>();
  for (const f of destinosOrdenados) {
    const label = companyCfg ? getFilialLabelForDisplay(companyCfg, f) : f;
    if (labelsVistos.has(label)) continue; // colapsa colunas com o mesmo rótulo
    labelsVistos.add(label);
    filiaisDestino.push(f);
    filialLabels[f] = label;
  }

  // Universo: itens com estoque positivo na Matriz (o que há para distribuir).
  const candidatos = network.filter((item) => {
    const m = item.filiais.find((f) => isMainMatrizFilial(company, f.filial));
    return Math.max(0, Math.round(m?.stock ?? 0)) > 0;
  });
  if (candidatos.length === 0) {
    return { matrizLabel, filiaisDestino, filialLabels, itens: [] };
  }

  // Metadados canônicos de produto (linha/subgrupo) — mesma fonte de vendas/produto do app
  // (fetchProductsWithDetails), necessários para a cobertura-alvo por linha da Compra Ideal.
  const details = await fetchProductsWithDetails({
    company,
    range: { start, end },
    filial: null,
    groupByColor: true,
  }).catch(() => []);
  const metaByKey = new Map<string, { linha: string | null; subgrupo: string | null }>();
  details.forEach((d) => {
    metaByKey.set(buildControleEstoqueItemKey(d.productId, d.corProduto), {
      linha: d.linha ?? null,
      subgrupo: d.subgrupo ?? null,
    });
  });

  const itensInput = dedupeControleEstoqueItens(
    candidatos.map((item) => ({ produto: item.produto, corProduto: item.codigoCor ?? item.cor }))
  );

  // Métricas em lote: Matriz + cada loja destino, todas na MESMA pipeline (1 chamada por filial).
  const todasFiliais = [matriz, ...filiaisDestino];
  const [metricasPorFilial, transitIndex] = await Promise.all([
    mapWithConcurrency(todasFiliais, FILIAL_CONCURRENCY, (name) =>
      getControleEstoqueMetricasItensBatched({ company, filial: name, itens: itensInput }).catch(
        () => ({} as MetricasMap)
      )
    ),
    buildTransitIndex(company),
  ]);
  const metricasMatriz = metricasPorFilial[0] ?? ({} as MetricasMap);
  const metricasLojas = filiaisDestino.map((_, i) => metricasPorFilial[i + 1] ?? ({} as MetricasMap));

  const itens = [];
  for (const item of candidatos) {
    const itemKey = buildControleEstoqueItemKey(item.produto, item.codigoCor ?? item.cor);
    const meta = metaByKey.get(itemKey) ?? { linha: null, subgrupo: item.subgrupo ?? null };

    const matrizResumo = metricasMatriz[itemKey]?.resumo ?? null;
    const matrizEstoque = Math.max(0, Math.round(matrizResumo?.estoqueTotal ?? 0));
    if (matrizEstoque <= 0) continue; // fonte canônica não confirma estoque na Matriz

    const transit = resolveTransit(transitIndex, item.produto, item.codigoCor, item.cor);

    const lojasInput: LojaDistribuicaoInput[] = filiaisDestino.map((filial, idx) => {
      const resumo = metricasLojas[idx]?.[itemKey]?.resumo ?? null;
      const estoqueAtual = Math.max(0, Math.round(resumo?.estoqueTotal ?? 0));
      const vende = (resumo?.qtde12m ?? 0) > 0;
      const ideal = calcCompraIdealFromResumo(resumo, transit, {
        linha: meta.linha,
        subgrupo: meta.subgrupo,
        company,
      });
      return { filial, filialLabel: filialLabels[filial], estoqueAtual, vende, ideal };
    });

    itens.push(
      montarDistribuicaoItem(
        {
          produto: item.produto,
          cor: item.cor,
          codigoCor: item.codigoCor,
          descricao: item.descricao,
          codigo: item.codigo,
          codigoBarra: item.codigoBarra,
          subgrupo: item.subgrupo,
          grade: item.grade,
          matrizEstoque,
        },
        lojasInput
      )
    );
  }

  itens.sort((a, b) => {
    if (b.lojasSemEstoque !== a.lojasSemEstoque) return b.lojasSemEstoque - a.lojasSemEstoque;
    return b.totalNecessidade - a.totalNecessidade;
  });

  return { matrizLabel, filiaisDestino, filialLabels, itens };
}
