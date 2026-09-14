import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
} from "@/lib/config/company";
import { listProdutosDescontinuados } from "@/lib/utils/produto-descontinuado-store";
import { buildDescontinuadoKeySet, isProdutoDescontinuado } from "@/lib/utils/produtos-descontinuados";
import { listFornecedoresByCompany } from "@/lib/utils/fornecedores-store";
import { productMatchesFornecedor, type ProdutoInfo } from "@/lib/utils/fornecedor-matcher";
import { fetchRupturasLoja, type RupturaItem } from "@/lib/repositories/lojaRaioX";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import {
  canonicalKey,
  encodeRowMembros,
  ROW_COR_FIELD,
  ROW_MEMBROS_FIELD,
  ROW_RUPTURA_FIELD,
} from "@/lib/reports/keys";
import { getControleEstoqueMetricasItensBatched } from "@/lib/server/controle-estoque-metricas";
import { fetchEstoqueProdutoPorFilialLote } from "@/lib/repositories/controleEstoque";
import {
  buildControleEstoqueItemKey,
  mergeControleEstoqueMetricasEntries,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import { listProdutoAgrupadoGroups } from "@/lib/utils/produto-agrupado-store";
import { aggregateProductDetailsWithGroups } from "@/lib/utils/produto-agrupado-aggregation";
import {
  buildProdutoAgrupadoLookup,
  buildProdutoAgrupadoProductKey,
  resolveProdutoAgrupadoCor,
  type ProdutoAgrupadoCorLookup,
  type ProdutoAgrupadoGroup,
} from "@/lib/utils/produtos-agrupados";
import { fetchProdutoCorDescricoes } from "@/lib/repositories/performance";
import {
  calcCompraIdealFromResumo,
  precisaComprarEssaSemana,
} from "@/lib/utils/compra-ideal";
import { ensureCompraCicloRuntime } from "@/lib/config/compra-ciclo-store";
import {
  buildCompraTransitoServerIndex,
  transitDescKey,
} from "@/lib/server/compra-transito-index";
import { COMPRA_FILIAL_COL_PREFIX } from "@/lib/reports/compra-sugerida-abc";
import { fetchControleTransferencias } from "@/lib/repositories/controleTransferencias";
import {
  buildTransferLensIndex,
  resolveTransferLens,
  applyTransferLens,
  type TransferLensDoadora,
  type TransferLensEntry,
  type TransferLensIndex,
} from "@/lib/utils/transferencia-regras";
import type { CompanyKey } from "@/lib/config/company";
import type { ProductDetail } from "@/lib/repositories/products";
import type { ReportRunContext } from "@/lib/reports/registry.server";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Quantas lojas calcular em paralelo (cada uma já batcheia os itens internamente). */
const FILIAL_CONCURRENCY = 3;

/**
 * Matriz nunca é COLUNA de compra sugerida — mesma exclusão do export "Compra Ideal por Loja"
 * da Curva ABC (CurvaAbcPage.tsx), que não sugere reposição de loja de varejo para a matriz.
 * Ela continua entrando no "Estoque rede" (é peça da rede, e na SCARF ME é onde está a maior
 * parte do estoque) — igual à coluna "Estoque rede" da tela da Curva ABC.
 */
const MATRIZ_BY_COMPANY: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeSet(values: string[] | null | undefined): Set<string> | null {
  const list = (values ?? []).map(up).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

/** Junta valores distintos num rótulo só ("101 / 102") — usado no "Código" da linha de grupo. */
function joinDistinct(values: Array<string | null | undefined>): string {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))
  ).join(" / ");
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Lente de transferência de um PRODUTO AGRUPADO: o excedente que a rede pode mover pelo
 * grupo é a soma do excedente dos membros, com as doadoras somadas por loja de origem.
 */
function mergeTransferLensEntries(entries: TransferLensEntry[]): TransferLensEntry | undefined {
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0];

  const doadoras = new Map<string, TransferLensDoadora>();
  let totalTransferivel = 0;
  for (const entry of entries) {
    totalTransferivel += Number(entry.totalTransferivel ?? 0);
    for (const doadora of entry.doadoras ?? []) {
      const current = doadoras.get(doadora.origemCanonico);
      if (current) {
        current.quantidade += Number(doadora.quantidade ?? 0);
      } else {
        doadoras.set(doadora.origemCanonico, { ...doadora });
      }
    }
  }

  return {
    ...entries[0]!,
    totalTransferivel,
    doadoras: Array.from(doadoras.values()),
    destinos: entries.flatMap((entry) => entry.destinos ?? []),
  };
}

/**
 * Análise "Compra sugerida por Curva ABC" — lista de compras consolidada da rede.
 *
 * Universo = TODOS os itens vendidos na rede no período (produto × cor), sem teto, ordenados
 * por faturamento (Curva ABC) — mesmo universo do export "Compra Ideal por Loja" da Curva ABC
 * (união dos itens vendidos em cada loja). Para cada item, calcula a Compra Ideal de CADA loja
 * com a MESMA fonte e regra da Lista Loja / Curva ABC (resumo de métricas com escopo na filial +
 * trânsito da rede abatido como pool → `calcCompraIdealFromResumo`). Item descontinuado nunca
 * sugere compra. A quantidade da loja só entra quando aquela loja precisa "comprar agora" (data
 * de compra já chegou) OU "comprar essa semana" (data cai antes do próximo dia de compra) —
 * espelha o filtro "Comprar agora" da Curva ABC / Lista Loja. Itens que nenhuma loja precisa
 * comprar agora ficam de fora. Matriz nunca entra como coluna de loja.
 *
 * As colunas por loja são dinâmicas (`COMPRA_FILIAL::{loja}`). Compra total e Custo total
 * são preenchidos com o valor estático aqui (tabela web) e viram FÓRMULAS no XLSX dedicado.
 *
 * Rupturas (opt-in, `filters.incluirRupturas`, preset "+ Rupturas"): roda a MESMA análise de
 * Rupturas da Loja Raio X (`fetchRupturasLoja`) uma vez por loja da rede, com os mesmos
 * filtros estruturais, e agrega à lista os itens que ela encontrou e a compra sugerida normal
 * NÃO capturou (produto×cor ainda não presente na lista principal) — nunca duplica. Mais caro
 * (uma consulta de vendas a mais por loja), mas fiel byte-a-byte à mesma lógica da página.
 *
 * Grupo de fornecedor (NERD, `filters.fornecedor`): aplicado aos DOIS lados (universo principal
 * e itens de ruptura) com o matcher compartilhado, antes do cálculo — ver `matchesFornecedor`.
 *
 * Produto agrupado (`filters.agruparProdutos`, LIGADO por padrão): os códigos cadastrados como
 * um item só viram UMA linha, com o nome do grupo, e a necessidade sai do grupo — venda,
 * estoque e janela de ritmo dos membros somados (`mergeControleEstoqueMetricasEntries`), igual
 * à Curva ABC. Sem isso cada membro pede reposição ignorando o estoque dos irmãos e a lista
 * infla. A linha de grupo carrega os membros reais em `ROW_MEMBROS_FIELD` — é por eles que o
 * `runReport` faz o filtro de fornecedor e a coluna "Código de barra". Ela NÃO abate trânsito
 * (unir o trânsito dos membros já zerou grupos inteiros em ago/2026).
 */
export async function fetchCompraSugeridaAbc(
  filters: ReportFilters,
  ctx?: ReportRunContext
): Promise<ReportResult> {
  // Prazos de ciclo editáveis na tela "Ciclo de Compra" — carrega antes do loop por item.
  await ensureCompraCicloRuntime();

  const [details, descontinuados] = await Promise.all([
    fetchProductsWithDetails({
      company: filters.company,
      range: { start: filters.start, end: filters.end },
      filial: null, // sempre a rede inteira — uma coluna por loja
      grupos: filters.grupos ?? null,
      linhas: filters.linhas ?? null,
      subgrupos: filters.subgrupos ?? null,
      grades: filters.grades ?? null,
      colecoes: filters.colecoes ?? null,
      produtoId: filters.produtoId ?? undefined,
      produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
      groupByColor: true,
    }),
    filters.company
      ? listProdutosDescontinuados(filters.company as CompanyKey).catch(() => [])
      : Promise.resolve([]),
  ]);
  const descontinuadoKeys = buildDescontinuadoKeySet(descontinuados);

  // Grupo de fornecedor (NERD): filtra o universo ANTES do cálculo por loja — mesma ordem da
  // Curva ABC (universo filtrado → compra ideal) e MESMO matcher que o `runReport` aplica depois.
  // Fazer aqui é o que mantém o resumo (Itens p/ comprar / Qtd / Custo total), a contagem de
  // rupturas agregadas e a base de dedupe coerentes com as linhas que sobram — o filtro do
  // `runReport` corta as linhas mas não recalcula o resumo. De quebra, não gasta consulta de
  // métricas × loja em item que vai ser descartado.
  const fornecedoresFiltro =
    filters.fornecedor && filters.company
      ? await listFornecedoresByCompany(filters.company)
      : null;
  const matchesFornecedor = (info: ProdutoInfo) =>
    !fornecedoresFiltro || productMatchesFornecedor(fornecedoresFiltro, filters.fornecedor as string, info);

  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);
  const filtered = details.filter((d) => {
    if (corSet && !corSet.has(up(d.descCorProduto))) return false;
    if (tipoSet && !tipoSet.has(up(d.tipo))) return false;
    // Mesmos campos que o runReport usa (PRODUTO / cor da linha / DESCRICAO).
    if (
      !matchesFornecedor({
        produto: String(d.productId ?? "").trim(),
        cor: d.corProduto ?? null,
        descricao: d.productName ?? null,
      })
    ) {
      return false;
    }
    return true;
  });
  filtered.sort((a, b) => b.totalRevenue - a.totalRevenue);

  const sumRevenue = filtered.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
  // Sem teto de itens — mesmo universo (sem corte de cauda) do export canônico da Curva ABC.
  const truncated = false;

  // ── PRODUTO AGRUPADO (ligado por padrão) ──────────────────────────────────────────
  // O cadastro "Produto agrupado" diz quais códigos o dono trata como UM item. Com os
  // membros soltos, cada código pede reposição ignorando o estoque dos irmãos e a lista
  // infla (medido em ago/2026: alça universal deu 56 un somando 10 códigos contra 10 un
  // no grupo). A fusão acontece DEPOIS dos filtros de cor/tipo/fornecedor, sobre linhas
  // reais — assim o grupo só carrega os membros que passaram pelo filtro.
  //
  // O relatório é sempre por COR, então o grupo quebra por cor (CAPA BASIC AZUL =
  // CP BASIC 1 AZUL + CP BASIC 2 AZUL) casando pela DESCRIÇÃO da cor, nunca pelo código
  // (o código é escopado por produto). `fetchProdutoCorDescricoes` monta esse mapa só
  // para os membros de grupo — mesma fonte/regra da Curva ABC.
  const agruparProdutos = filters.agruparProdutos !== false;
  const grupos: ProdutoAgrupadoGroup[] =
    agruparProdutos && filters.company
      ? await listProdutoAgrupadoGroups(filters.company as CompanyKey).catch(() => [])
      : [];
  let corDescricoes: ProdutoAgrupadoCorLookup | null = null;
  if (grupos.length > 0) {
    corDescricoes = await fetchProdutoCorDescricoes(
      grupos.flatMap((grupo) => grupo.members.map((member) => member.produto))
    ).catch(() => null);
  }
  const candidates =
    grupos.length > 0
      ? aggregateProductDetailsWithGroups(filtered, grupos, {
          groupByColor: true,
          corDescricoes,
        })
      : filtered;

  /**
   * Plano por linha: a linha do grupo é calculada a partir dos MEMBROS reais (o id
   * sintético `__PRODUTO_AGRUPADO__:…` não existe no ERP e não tem métrica nem estoque).
   * Linha normal = um membro só, ela mesma.
   */
  interface ItemPlan {
    detail: ProductDetail;
    agrupado: boolean;
    membros: Array<{ produto: string; corProduto: string | null }>;
  }
  const plans: ItemPlan[] = candidates.map((d) => {
    const agrupado = d.isGroupedProduct === true && (d.groupedMembers?.length ?? 0) > 0;
    return {
      detail: d,
      agrupado,
      membros: agrupado
        ? d.groupedMembers!.map((member) => ({
            produto: String(member.produto ?? "").trim(),
            corProduto: String(member.cor ?? "").trim() || null,
          }))
        : [
            {
              produto: String(d.productId ?? "").trim(),
              corProduto: d.corProduto ?? null,
            },
          ],
    };
  });

  // ── Lojas da rede (nomes canônicos ativos, sem matriz) + rótulos de exibição (deduplicados) ──
  const company = await resolveCompanyLive(filters.company);
  const matrizNames = MATRIZ_BY_COMPANY[filters.company ?? ""] ?? [];
  const matrizSet = new Set(matrizNames);
  const filialNames = company
    ? getOperationalFilials(company, "sales").filter((f) => !matrizSet.has(f))
    : [];
  const orderedNames = [...filialNames].sort((a, b) =>
    company
      ? compareFilialDisplayOrder(
          getFilialLabelForDisplay(company, a),
          getFilialLabelForDisplay(company, b),
          company
        )
      : a.localeCompare(b, "pt-BR")
  );
  const labelByName = new Map<string, string>();
  const orderedLabels: string[] = [];
  const seenLabel = new Set<string>();
  for (const name of orderedNames) {
    const label = company ? getFilialLabelForDisplay(company, name) : name;
    labelByName.set(name, label);
    if (!seenLabel.has(label)) {
      seenLabel.add(label);
      orderedLabels.push(label);
    }
  }

  // ── Métricas por loja (1 lote por loja) + trânsito da rede ──
  // Consulta os MEMBROS (deduplicados): é deles que vem estoque/venda/ritmo; o grupo é
  // montado somando os membros com `mergeControleEstoqueMetricasEntries`.
  const itensLookup = new Map<string, { produto: string; corProduto: string | null }>();
  for (const plan of plans) {
    for (const membro of plan.membros) {
      if (!membro.produto) continue;
      itensLookup.set(buildControleEstoqueItemKey(membro.produto, membro.corProduto), membro);
    }
  }
  const itensInput = Array.from(itensLookup.values());
  // Progresso por loja (cada loja = 1 lote, parte cara da análise). A fase "lojas" começa
  // em 0/N e avança a cada loja concluída; o front mostra "Calculando compra por loja… X/N".
  let lojasFeitas = 0;
  ctx?.onProgress?.(0, orderedNames.length, "lojas");
  const [metricasPorFilial, estoqueMatrizPorItem, transitIndex, transferLens] = await Promise.all([
    mapWithConcurrency(orderedNames, FILIAL_CONCURRENCY, (name) =>
      getControleEstoqueMetricasItensBatched({
        company: filters.company,
        filial: name,
        includeHistorico: true,
        itens: itensInput,
      })
        .catch(() => ({}) as Record<string, never>)
        .finally(() => {
          lojasFeitas += 1;
          ctx?.onProgress?.(lojasFeitas, orderedNames.length, "lojas");
        })
    ),
    // Estoque da MATRIZ (só saldo, sem histórico/compra ideal): entra no "Estoque rede",
    // nunca numa coluna de loja. Uma consulta em lote por matriz, bem mais barata que a
    // rodada de métricas de uma loja.
    Promise.all(
      matrizNames.map((name) =>
        fetchEstoqueProdutoPorFilialLote({ company: filters.company, filial: name, itens: itensInput }).catch(
          () => new Map<string, Array<{ filial: string; estoque: number }>>()
        )
      )
    ),
    buildCompraTransitoServerIndex(filters.company),
    // Lente de transferência (opt-in): mesma régua/janela (30d) do Controle de Transferências.
    filters.considerarTransferencias
      ? fetchControleTransferencias({ company: filters.company, filial: null })
          .then((data) => buildTransferLensIndex(data, filters.company as CompanyKey))
          .catch(() => null as TransferLensIndex | null)
      : Promise.resolve(null as TransferLensIndex | null),
  ]);

  const hoje = new Date();
  const dynamicColumns: ReportColumnDef[] = orderedLabels.map((label) => ({
    key: `${COMPRA_FILIAL_COL_PREFIX}${label}`,
    defaultLabel: label,
    type: "int" as const,
  }));

  let acumPerc = 0;
  let itensRuptura = 0;
  const rows: ReportRow[] = [];
  /**
   * Chave produto×cor REAL de tudo que já saiu numa linha (inclusive de cada membro de
   * grupo). É por ela que a fase de rupturas sabe o que já está coberto — o `PRODUTO` da
   * linha de grupo é um rótulo, não serve de chave.
   */
  const baseMemberKeys = new Set<string>();
  /**
   * Cada grupo AVALIADO (tenha emitido linha ou não), por loja: estoque do grupo naquela
   * loja (membros somados) e a compra ideal do grupo SEM o corte de "comprar agora". É o que
   * a fase de rupturas consulta — num agrupamento os membros são o mesmo item com outro nome,
   * então membro zerado com irmão cheio na mesma loja NÃO é ruptura.
   */
  interface GrupoAvaliado {
    porLabel: Map<string, { estoque: number; idealFull: number }>;
    membros: Array<{ produto: string; corProduto: string | null }>;
  }
  const gruposAvaliados = new Map<string, GrupoAvaliado>();
  for (const plan of plans) {
    const d = plan.detail;
    const revenue = d.totalRevenue ?? 0;
    const partPerc = sumRevenue !== 0 ? (revenue / sumRevenue) * 100 : 0;
    acumPerc += partPerc;
    const curva = acumPerc <= 60 ? "A" : acumPerc <= 90 ? "B" : "C";

    // Linha de grupo: o "Código" mostra os membros reais (o id sintético é interno e não
    // existe no ERP). A descrição já vem com o nome do grupo, vindo da agregação.
    const pid = plan.agrupado
      ? joinDistinct(plan.membros.map((m) => m.produto))
      : String(d.productId ?? "").trim();
    const corKey = d.corProduto ? String(d.corProduto).trim() : null;
    const itemKeys = plan.membros.map((m) => buildControleEstoqueItemKey(m.produto, m.corProduto));
    // Grupo só é descontinuado quando TODOS os membros são — um membro vivo ainda repõe.
    const isDescontinuado = plan.membros.every((m) =>
      isProdutoDescontinuado(descontinuadoKeys, m.produto)
    );
    // ⛔ Trânsito de grupo NÃO é a união do trânsito dos membros: já foi tentado (ago/2026)
    // e zerou a necessidade de grupos inteiros. A linha agrupada não abate trânsito.
    let transit = plan.agrupado ? [] : transitIndex.get(canonicalKey(pid, corKey)) ?? [];
    if (!plan.agrupado && transit.length === 0) {
      // Fallback por descrição de cor (códigos divergentes para a mesma cor, etc.).
      const dk = transitDescKey(pid, corKey, d.descCorProduto);
      if (dk) transit = transitIndex.get(dk) ?? [];
    }

    // Compra sugerida de cada loja, somada por rótulo (lojas que colapsam no mesmo label).
    const qtyByLabel = new Map<string, number>();
    const statsByLabel = plan.agrupado
      ? new Map<string, { estoque: number; idealFull: number }>()
      : null;
    let total = 0;
    let custoMax = 0;
    let estoqueRede = 0;
    orderedNames.forEach((name, idx) => {
      // Grupo: soma os membros (estoque nunca soma negativo, janela de ritmo agregada) —
      // mesma fusão da Curva ABC. Item normal: a métrica dele, sem custo extra.
      const metricasMembros = itemKeys
        .map((key) => metricasPorFilial[idx]?.[key])
        .filter((m): m is ControleEstoqueItemMetricas => Boolean(m));
      const metricas =
        metricasMembros.length === 0
          ? null
          : metricasMembros.length === 1
            ? metricasMembros[0]!
            : mergeControleEstoqueMetricasEntries(metricasMembros);
      const ideal = calcCompraIdealFromResumo(metricas?.resumo ?? null, transit, {
        linha: d.linha,
        subgrupo: d.subgrupo,
        company: filters.company,
      });
      // Descontinuado nunca sugere compra → 0 em toda loja (mesma regra do export da Curva ABC).
      const precisaAgora =
        !isDescontinuado &&
        ideal.status === "REPOR" &&
        (ideal.comprarAgora || precisaComprarEssaSemana(ideal, filters.company, hoje));
      const qtd = precisaAgora ? Math.max(0, ideal.compraIdeal) : 0;
      const label = labelByName.get(name) ?? name;
      if (qtd > 0) qtyByLabel.set(label, (qtyByLabel.get(label) ?? 0) + qtd);
      total += qtd;
      custoMax = Math.max(custoMax, Number(metricas?.resumo?.custoUnitario ?? 0));
      // Estoque negativo nunca conta — soma só os saldos positivos de cada loja.
      const estoqueLoja = Math.max(0, Number(metricas?.resumo?.estoqueTotal ?? 0));
      estoqueRede += estoqueLoja;
      if (statsByLabel) {
        // Ungated: a fase de rupturas existe justamente para furar o corte de "comprar agora".
        const idealFull = isDescontinuado ? 0 : Math.max(0, ideal.compraIdeal);
        const atual = statsByLabel.get(label);
        if (atual) {
          atual.estoque += estoqueLoja;
          atual.idealFull += idealFull;
        } else {
          statsByLabel.set(label, { estoque: estoqueLoja, idealFull });
        }
      }
    });
    // Registrado ANTES do corte por total — grupo sem necessidade é exatamente o caso que a
    // fase de rupturas precisa enxergar para não ressuscitar o membro zerado.
    if (plan.agrupado && statsByLabel && d.groupId) {
      gruposAvaliados.set(`${d.groupId}||${String(d.corProduto ?? "").trim()}`, {
        porLabel: statsByLabel,
        membros: plan.membros,
      });
    }
    // + MATRIZ (sem coluna de compra): fecha com a coluna "Estoque rede" da tela da Curva ABC,
    // que soma lojas + matriz. Sem isso o arquivo mostrava a rede sem o maior estoque dela.
    for (const mapa of estoqueMatrizPorItem) {
      for (const key of itemKeys) {
        for (const linha of mapa.get(key) ?? []) {
          estoqueRede += Math.max(0, Number(linha.estoque ?? 0));
        }
      }
    }

    if (total <= 0) continue; // só itens que alguma loja precisa comprar agora/essa semana

    for (const membro of plan.membros) {
      baseMemberKeys.add(canonicalKey(membro.produto, membro.corProduto));
    }

    const custoUnit = custoMax > 0 ? custoMax : (d.cost ?? 0);
    const row: ReportRow = {
      [ROW_COR_FIELD]: corKey ?? "",
      CURVA: curva,
      PRODUTO: pid,
      COR: corKey ?? "",
      COR_DESCRICAO: d.descCorProduto ?? "",
      DESCRICAO: d.productName ?? "",
      GRUPO: d.grupo ?? "",
      SUBGRUPO: d.subgrupo ?? "",
      LINHA: d.linha ?? "",
      TIPO: d.tipo ?? "",
      GRADE: d.grade ?? "",
      CUSTO_UNITARIO: round2(custoUnit),
      ESTOQUE_REDE: roundInt(estoqueRede),
      COMPRA_TOTAL: roundInt(total),
      CUSTO_TOTAL: round2(custoUnit * total),
    };
    // Linha de grupo carrega os membros reais: sem isso o pós-processamento por produto
    // (filtro de fornecedor, coluna Código de barra) casaria zero e ela sumiria calada.
    if (plan.agrupado) {
      row[ROW_MEMBROS_FIELD] = encodeRowMembros(
        plan.membros.map((m) => ({ produto: m.produto, cor: m.corProduto }))
      );
    }
    for (const dyn of dynamicColumns) {
      const label = dyn.key.slice(COMPRA_FILIAL_COL_PREFIX.length);
      row[dyn.key] = roundInt(qtyByLabel.get(label) ?? 0);
    }

    // Lente de transferência: desconta da compra o que a rede pode mover (read-only).
    // Linha de grupo: a lente é resolvida MEMBRO A MEMBRO e somada — o rótulo do grupo
    // não existe no índice. (É soma de excedente real, não união de trânsito.)
    if (transferLens) {
      const entry = plan.agrupado
        ? mergeTransferLensEntries(
            plan.membros
              .map((m) => resolveTransferLens(transferLens, m.produto, m.corProduto))
              .filter((e): e is TransferLensEntry => Boolean(e))
          )
        : resolveTransferLens(transferLens, pid, corKey);
      const lente = applyTransferLens(total, entry);
      row.TRANSFERIVEL = roundInt(lente.disponivelTransferir);
      row.COMPRA_LIQUIDA = roundInt(lente.compraLiquida);
      row.CUSTO_LIQUIDO = round2(custoUnit * lente.compraLiquida);
      row.TRANSFERIR_DE = lente.doadoras
        .map((doadora) => `${doadora.origem} (${roundInt(doadora.quantidade)})`)
        .join(" · ");
    }

    rows.push(row);
  }

  // ── Rupturas (opt-in, preset "+ Rupturas") ──────────────────────────────────────────
  // Roda a MESMA análise de Rupturas do Loja Raio X, uma vez por loja da rede (mesmas
  // filiais/filtros de cima), e agrega à lista os itens que a compra sugerida normal NÃO
  // capturou. Nunca duplica: item já presente na lista principal (mesma chave produto×cor)
  // é ignorado — as colunas dele não são tocadas.
  if (filters.incluirRupturas && filters.start && filters.end && orderedNames.length > 0) {
    // Cobertura medida pelos MEMBROS reais (ver `baseMemberKeys`): ruptura de um membro cuja
    // linha de grupo já saiu é absorvida (o grupo decidiu), nunca vira linha duplicada.
    const grupoLookup = buildProdutoAgrupadoLookup(grupos);
    const rupturaRange = normalizeRangeForQuery({ start: filters.start, end: filters.end });

    let rupturasFeitas = 0;
    ctx?.onProgress?.(0, orderedNames.length, "rupturas");
    const porFilialRupturas = await mapWithConcurrency(orderedNames, FILIAL_CONCURRENCY, async (name) => {
      const itens = await fetchRupturasLoja({
        company: filters.company,
        filial: name,
        range: rupturaRange,
        linhas: filters.linhas ?? undefined,
        grupos: filters.grupos ?? undefined,
        subgrupos: filters.subgrupos ?? undefined,
        grades: filters.grades ?? undefined,
        colecoes: filters.colecoes ?? undefined,
        cores: filters.cores ?? undefined,
        tipos: filters.tipos ?? undefined,
        produtoId: filters.produtoId ?? undefined,
        produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
        withCompraIdeal: true,
      }).catch(() => [] as RupturaItem[]);
      rupturasFeitas += 1;
      ctx?.onProgress?.(rupturasFeitas, orderedNames.length, "rupturas");
      return itens;
    });

    interface ExtraAcc {
      agrupado: boolean;
      cor: string;
      corDescricao: string;
      descricao: string;
      grupo: string;
      subgrupo: string;
      linha: string;
      tipo: string;
      grade: string;
      custoUnitario: number;
      /** Estoque de rede por MEMBRO (o mesmo membro repete por loja → fica o maior). */
      estoqueRedePorMembro: Map<string, number>;
      membros: Map<string, { produto: string; cor: string | null }>;
      /** Quantidade por loja — o total da linha é a soma dela (ver emissão abaixo). */
      qtyByLabel: Map<string, number>;
    }
    const extraByKey = new Map<string, ExtraAcc>();
    orderedNames.forEach((name, idx) => {
      const label = labelByName.get(name) ?? name;
      for (const item of porFilialRupturas[idx] ?? []) {
        if (item.compraIdealQtd <= 0) continue; // só o que realmente precisa repor
        // `fetchRupturasLoja` não conhece grupo de fornecedor — aplica a mesma régua do universo
        // principal, senão a ruptura reintroduz item de outro fornecedor pela porta de trás.
        if (!matchesFornecedor({ produto: item.produto, cor: item.cor, descricao: item.descricao })) {
          continue;
        }
        const membroKey = canonicalKey(item.produto, item.cor);
        if (baseMemberKeys.has(membroKey)) continue; // já coberto pela lista principal

        // Membro de grupo cujo grupo NÃO tem linha: os membros em ruptura se juntam numa
        // linha só, com o nome do grupo.
        const grupo = grupoLookup.get(buildProdutoAgrupadoProductKey(item.produto));
        const corGrupo = grupo
          ? resolveProdutoAgrupadoCor(item.produto, item.cor, item.corDescricao, corDescricoes)
          : null;
        const key = grupo && corGrupo ? `${grupo.id}||${corGrupo.key}` : membroKey;

        // ⛔ Num agrupamento os membros são O MESMO item com outro nome: `fetchRupturasLoja`
        // olha um código por vez e enxerga ruptura onde o grupo tem estoque no irmão. Quem
        // decide é o grupo — com saldo do grupo NAQUELA loja, não há ruptura e a linha nem
        // nasce. Sem saldo, a quantidade é a do GRUPO (ungated), nunca a soma dos membros:
        // somar membro a membro seria a mesma inflação que o agrupamento existe para evitar.
        const avaliado =
          grupo && corGrupo ? gruposAvaliados.get(`${grupo.id}||${corGrupo.key}`) : undefined;
        if (avaliado) {
          const cell = avaliado.porLabel.get(label);
          if ((cell?.estoque ?? 0) > 0) continue; // irmão cobre esta loja — não é ruptura
          if ((cell?.idealFull ?? 0) <= 0) continue; // grupo não precisa repor nem sem o corte
        }

        const acc = extraByKey.get(key) ?? {
          agrupado: Boolean(grupo),
          cor: grupo && corGrupo ? corGrupo.key : item.cor,
          corDescricao: grupo && corGrupo ? corGrupo.label : item.corDescricao,
          descricao: grupo ? grupo.nome : item.descricao,
          grupo: item.grupo ?? "",
          subgrupo: item.subgrupo ?? "",
          linha: item.linha ?? "",
          tipo: item.tipo ?? "",
          grade: item.grade ?? "",
          custoUnitario: item.custoUnitario,
          estoqueRedePorMembro: new Map<string, number>(),
          membros: new Map<string, { produto: string; cor: string | null }>(),
          qtyByLabel: new Map<string, number>(),
        };
        acc.custoUnitario = Math.max(acc.custoUnitario, item.custoUnitario);
        acc.estoqueRedePorMembro.set(
          membroKey,
          Math.max(acc.estoqueRedePorMembro.get(membroKey) ?? 0, item.estoqueRede)
        );
        if (avaliado) {
          // Grupo avaliado: membros vindos do plano (lista completa) e quantidade do grupo,
          // gravada com `set` — idempotente, o 2º membro da mesma loja não soma de novo.
          for (const membro of avaliado.membros) {
            acc.membros.set(canonicalKey(membro.produto, membro.corProduto), {
              produto: membro.produto,
              cor: membro.corProduto,
            });
          }
          acc.qtyByLabel.set(label, avaliado.porLabel.get(label)?.idealFull ?? 0);
        } else {
          acc.membros.set(membroKey, { produto: item.produto, cor: item.cor || null });
          acc.qtyByLabel.set(label, (acc.qtyByLabel.get(label) ?? 0) + item.compraIdealQtd);
        }
        extraByKey.set(key, acc);
      }
    });

    for (const acc of extraByKey.values()) {
      const total = Array.from(acc.qtyByLabel.values()).reduce((s, v) => s + Math.max(0, v), 0);
      if (total <= 0) continue; // grupo que acabou sem necessidade nenhuma não vira linha
      const membros = Array.from(acc.membros.values());
      const estoqueRede = Array.from(acc.estoqueRedePorMembro.values()).reduce(
        (s, v) => s + Math.max(0, v),
        0
      );
      const row: ReportRow = {
        [ROW_COR_FIELD]: acc.cor ?? "",
        [ROW_RUPTURA_FIELD]: 1,
        CURVA: "RUPTURA",
        PRODUTO: joinDistinct(membros.map((m) => m.produto)),
        COR: acc.cor ?? "",
        COR_DESCRICAO: acc.corDescricao ?? "",
        DESCRICAO: acc.descricao ?? "",
        GRUPO: acc.grupo,
        SUBGRUPO: acc.subgrupo,
        LINHA: acc.linha,
        TIPO: acc.tipo,
        GRADE: acc.grade,
        CUSTO_UNITARIO: round2(acc.custoUnitario),
        ESTOQUE_REDE: roundInt(estoqueRede),
        COMPRA_TOTAL: roundInt(total),
        CUSTO_TOTAL: round2(acc.custoUnitario * total),
      };
      if (acc.agrupado) {
        row[ROW_MEMBROS_FIELD] = encodeRowMembros(membros);
      }
      for (const dyn of dynamicColumns) {
        const label = dyn.key.slice(COMPRA_FILIAL_COL_PREFIX.length);
        row[dyn.key] = roundInt(acc.qtyByLabel.get(label) ?? 0);
      }
      rows.push(row);
    }
    itensRuptura = rows.filter((r) => Number(r[ROW_RUPTURA_FIELD] ?? 0) === 1).length;
  }

  const sumQtde = rows.reduce((s, r) => s + Number(r.COMPRA_TOTAL ?? 0), 0);
  const sumCusto = rows.reduce((s, r) => s + Number(r.CUSTO_TOTAL ?? 0), 0);
  const summary: ReportSummaryMetric[] = [
    { label: "Itens p/ comprar", value: rows.length, format: "int" },
    ...(itensRuptura > 0 ? [{ label: "Itens de ruptura agregados", value: itensRuptura, format: "int" as const }] : []),
    { label: "Qtd total", value: roundInt(sumQtde), format: "int" },
    { label: "Custo total", value: round2(sumCusto), format: "currency" },
  ];

  await applyColecaoLabels(filters.company, rows);

  return { rows, total: rows.length, truncated, summary, dynamicColumns };
}
