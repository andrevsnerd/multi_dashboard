import type { FilialProdutoSalesRow, ProdutoEstoquePorFilialRow, ProdutoQtdePorFilialRow } from "@/lib/repositories/performance";
import type { ProductDetail } from "@/lib/repositories/products";

import {
  buildProdutoAgrupadoLookup,
  buildProdutoAgrupadoProductKey,
  buildProdutoAgrupadoSyntheticId,
  normalizeProdutoAgrupadoCorCode,
  resolveProdutoAgrupadoCor,
  type ProdutoAgrupadoCorLookup,
  type ProdutoAgrupadoGroup,
  type ProdutoAgrupadoMember,
} from "@/lib/utils/produtos-agrupados";

/*
 * Agregação dos PRODUTOS AGRUPADOS.
 *
 * O grupo é montado no nível PRODUTO (CAPA BASIC = CP BASIC 1 + CP BASIC 2),
 * mas quando a tela/relatório está por COR o grupo continua quebrando por cor:
 *
 *   CAPA BASIC AZUL     = CP BASIC 1 AZUL     + CP BASIC 2 AZUL
 *   CAPA BASIC VERMELHO = CP BASIC 1 VERMELHO + CP BASIC 2 VERMELHO
 *
 * A fusão casa pela DESCRIÇÃO da cor, nunca pelo código: o código é escopado por
 * produto (o 06 de um produto é outra cor em outro). Sem descrição, o membro
 * fica na sua própria linha — separar demais é o lado seguro do erro.
 *
 * ESTOQUE NUNCA SOMA NEGATIVO. Se uma loja tem 5 de CP BASIC 1 AZUL e -3 de
 * CP BASIC 2 AZUL, o grupo tem 5 (e não 2). Só quando NENHUM membro tem saldo
 * positivo é que o negativo aparece — mesma regra do produto individual
 * (pos > 0 ? pos : neg), só que um nível acima.
 */

type ProductDetailAccumulator = ProductDetail & {
  _groupPreviousRevenue?: number;
  _groupPreviousQuantity?: number;
  _groupPositiveStock?: number;
  _groupNegativeStock?: number;
  _groupPositiveEstoqueRede?: number;
  _groupNegativeEstoqueRede?: number;
};

export interface ProdutoAgrupadoAggregationOptions {
  /** Quebra o grupo por cor (espelha o toggle "por cor" da tela/relatório). */
  groupByCor?: boolean;
  /** produto+cor -> DESC_COR_PRODUTO, para casar a mesma cor entre produtos. */
  corDescricoes?: ProdutoAgrupadoCorLookup | null;
}

function joinDistinct(values: Array<string | null | undefined>): string {
  const unique = Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );

  return unique.join(" / ");
}

function computeWeightedAverage(totalValue: number, totalQuantity: number): number {
  if (!Number.isFinite(totalValue) || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
    return 0;
  }
  return totalValue / totalQuantity;
}

function computeVariance(current: number, previous: number): number | null {
  if (previous > 0) {
    return ((current - previous) / previous) * 100;
  }

  if (current > 0) {
    return null;
  }

  return 0;
}

function estimatePreviousValueFromVariance(current: number, variance: number | null | undefined): number {
  if (!Number.isFinite(current) || current <= 0 || variance == null || !Number.isFinite(variance)) {
    return 0;
  }

  const factor = 1 + variance / 100;
  if (factor <= 0) return 0;
  return current / factor;
}

/** Estoque do grupo: soma só os positivos; o negativo só aparece se não houver nenhum positivo. */
function resolveGroupStock(positive: number, negative: number): number {
  return positive > 0 ? positive : negative;
}

function buildProductDetailKey(row: ProductDetail, groupByCor: boolean): string {
  const cor = groupByCor ? (row.corProduto ?? "").trim() : "";
  return `${row.productId}||${cor}`;
}

function buildSalesRowKey(row: FilialProdutoSalesRow, groupByCor: boolean): string {
  const cor = groupByCor ? (row.cor ?? "").trim() : "";
  return `${row.produto}||${row.categoria}||${row.grade}||${cor}`;
}

function buildQtdeRowKey(
  row: Pick<ProdutoQtdePorFilialRow, "produto" | "cor" | "filial">,
  groupByCor: boolean
): string {
  const cor = groupByCor ? (row.cor ?? "").trim() : "";
  return `${row.produto}||${cor}||${row.filial}`;
}

function buildEstoqueRowKey(
  row: Pick<ProdutoEstoquePorFilialRow, "produto" | "cor" | "filial">,
  groupByCor: boolean
): string {
  const cor = groupByCor ? (row.cor ?? "").trim() : "";
  return `${row.produto}||${cor}||${row.filial}`;
}

/** Chave do balde do grupo: um balde por cor quando `groupByCor`, senão um só. */
function buildGroupAggregationKey(groupId: string, corKey: string): string {
  return `${buildProdutoAgrupadoSyntheticId(groupId)}||${corKey}`;
}

/**
 * Membros do balde. Com quebra por cor, cada (produto, código de cor) vira um
 * membro próprio — o código REAL precisa sobreviver, porque é ele que a tela usa
 * para buscar métricas/trânsito de cada membro. Sem quebra por cor, dedup por
 * produto e as cores viram um rótulo só.
 */
function buildGroupedMembers(
  members: ProdutoAgrupadoMember[],
  groupByCor: boolean
): ProdutoAgrupadoMember[] {
  const unique = new Map<string, ProdutoAgrupadoMember>();
  for (const member of members) {
    const produtoKey = buildProdutoAgrupadoProductKey(member.produto);
    const key = groupByCor
      ? `${produtoKey}||${normalizeProdutoAgrupadoCorCode(member.cor)}`
      : produtoKey;
    if (!unique.has(key)) {
      unique.set(key, { ...member });
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

/** Igual a `buildGroupedMembers`, mas acumula vendas/qtde dos membros que colapsam. */
function buildGroupedMembersWithSales(
  members: ProdutoAgrupadoMember[],
  groupByCor: boolean
): ProdutoAgrupadoMember[] {
  const unique = new Map<string, ProdutoAgrupadoMember>();
  for (const member of members) {
    const produtoKey = buildProdutoAgrupadoProductKey(member.produto);
    const key = groupByCor
      ? `${produtoKey}||${normalizeProdutoAgrupadoCorCode(member.cor)}`
      : produtoKey;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        ...member,
        vendas: Number(member.vendas ?? 0),
        qtde: Number(member.qtde ?? 0),
        averagePrice: Number(member.averagePrice ?? 0),
        cost: Number(member.cost ?? 0),
        markup: Number(member.markup ?? 0),
      });
    } else {
      const existingRevenue = Number(existing.vendas ?? 0);
      const incomingRevenue = Number(member.vendas ?? 0);
      const existingQuantity = Number(existing.qtde ?? 0);
      const incomingQuantity = Number(member.qtde ?? 0);
      const nextRevenue = existingRevenue + incomingRevenue;
      const nextQuantity = existingQuantity + incomingQuantity;
      const existingCostValue = Number(existing.cost ?? 0) * existingQuantity;
      const incomingCostValue = Number(member.cost ?? 0) * incomingQuantity;

      existing.vendas = nextRevenue;
      existing.qtde = nextQuantity;
      existing.averagePrice = computeWeightedAverage(nextRevenue, nextQuantity);
      existing.cost = computeWeightedAverage(existingCostValue + incomingCostValue, nextQuantity);
      existing.markup =
        Number(existing.cost ?? 0) > 0
          ? Number(existing.averagePrice ?? 0) / Number(existing.cost ?? 0)
          : 0;
      existing.cor = joinDistinct([existing.cor, member.cor]);
      existing.corDescricao = joinDistinct([existing.corDescricao, member.corDescricao]);
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    (b.vendas ?? 0) - (a.vendas ?? 0) || a.descricao.localeCompare(b.descricao, "pt-BR")
  );
}

export function aggregateProductDetailsWithGroups(
  rows: ProductDetail[],
  groups: ProdutoAgrupadoGroup[],
  options?: ProdutoAgrupadoAggregationOptions & { groupByColor?: boolean }
): ProductDetail[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByColor === true || options?.groupByCor === true;
  const corLookup = options?.corDescricoes ?? null;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProductDetailAccumulator>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.productId));
    if (!group) {
      aggregated.set(buildProductDetailKey(row, groupByCor), { ...row });
      continue;
    }

    // Por cor: um balde por cor canônica. Sem cor: tudo num balde só.
    const cor = groupByCor
      ? resolveProdutoAgrupadoCor(row.productId, row.corProduto, row.descCorProduto, corLookup)
      : { key: "", label: "" };
    const key = buildGroupAggregationKey(group.id, cor.key);
    const syntheticId = buildProdutoAgrupadoSyntheticId(group.id);
    const rowStock = Number(row.stock ?? 0);
    const rowEstoqueRede = Number(row.estoqueRede ?? 0);
    const incomingMember: ProdutoAgrupadoMember = {
      produto: row.productId,
      cor: String(row.corProduto ?? "").trim(),
      descricao: row.productName,
      corDescricao: row.descCorProduto ?? "",
      vendas: Number(row.totalRevenue ?? 0),
      qtde: Number(row.totalQuantity ?? 0),
      averagePrice: Number(row.averagePrice ?? 0),
      cost: Number(row.cost ?? 0),
      markup: Number(row.markup ?? 0),
      stock: rowStock,
      estoqueRede: rowEstoqueRede,
    };
    const current = aggregated.get(key);

    if (!current) {
      aggregated.set(key, {
        ...row,
        productId: syntheticId,
        productName: group.nome,
        corProduto: cor.key,
        descCorProduto: cor.label,
        cost: Number(row.cost ?? 0),
        averagePrice: Number(row.averagePrice ?? 0),
        markup: Number(row.markup ?? 0),
        suggestedPrice: row.suggestedPrice ?? null,
        // Consolidado de verdade no passe final (positivos primeiro, negativo nunca soma).
        stock: resolveGroupStock(Math.max(0, rowStock), Math.min(0, rowStock)),
        estoqueRede: resolveGroupStock(Math.max(0, rowEstoqueRede), Math.min(0, rowEstoqueRede)),
        isGroupedProduct: true,
        groupId: group.id,
        groupedMembers: buildGroupedMembers([incomingMember], groupByCor),
        _groupPreviousRevenue: estimatePreviousValueFromVariance(row.totalRevenue, row.revenueVariance),
        _groupPreviousQuantity: estimatePreviousValueFromVariance(row.totalQuantity, row.quantityVariance),
        _groupPositiveStock: Math.max(0, rowStock),
        _groupNegativeStock: Math.min(0, rowStock),
        _groupPositiveEstoqueRede: Math.max(0, rowEstoqueRede),
        _groupNegativeEstoqueRede: Math.min(0, rowEstoqueRede),
      });
      continue;
    }

    const currentRevenue = Number(current.totalRevenue ?? 0);
    const currentQuantity = Number(current.totalQuantity ?? 0);
    const rowRevenue = Number(row.totalRevenue ?? 0);
    const rowQuantity = Number(row.totalQuantity ?? 0);
    const currentCostValue = Number(current.cost ?? 0) * currentQuantity;
    const rowCostValue = Number(row.cost ?? 0) * rowQuantity;
    const currentSuggestedValue =
      (current.suggestedPrice ?? 0) * (currentQuantity > 0 ? currentQuantity : 0);
    const rowSuggestedValue = (row.suggestedPrice ?? 0) * (rowQuantity > 0 ? rowQuantity : 0);
    const nextRevenue = currentRevenue + rowRevenue;
    const nextQuantity = currentQuantity + rowQuantity;
    current.totalRevenue = nextRevenue;
    current.totalQuantity = nextQuantity;
    current._groupPositiveStock = Number(current._groupPositiveStock ?? 0) + Math.max(0, rowStock);
    current._groupNegativeStock = Number(current._groupNegativeStock ?? 0) + Math.min(0, rowStock);
    current._groupPositiveEstoqueRede =
      Number(current._groupPositiveEstoqueRede ?? 0) + Math.max(0, rowEstoqueRede);
    current._groupNegativeEstoqueRede =
      Number(current._groupNegativeEstoqueRede ?? 0) + Math.min(0, rowEstoqueRede);
    current.averagePrice = computeWeightedAverage(nextRevenue, nextQuantity);
    current.cost = computeWeightedAverage(currentCostValue + rowCostValue, nextQuantity);
    current.markup = current.cost > 0 ? current.averagePrice / current.cost : 0;
    current.suggestedPrice =
      currentSuggestedValue + rowSuggestedValue > 0
        ? computeWeightedAverage(currentSuggestedValue + rowSuggestedValue, nextQuantity)
        : null;
    current._groupPreviousRevenue =
      Number(current._groupPreviousRevenue ?? 0) +
      estimatePreviousValueFromVariance(row.totalRevenue, row.revenueVariance);
    current._groupPreviousQuantity =
      Number(current._groupPreviousQuantity ?? 0) +
      estimatePreviousValueFromVariance(row.totalQuantity, row.quantityVariance);
    current.isNew = Number(current._groupPreviousRevenue ?? 0) <= 0 && current.totalRevenue > 0;
    current.registrationDate = joinDistinct([current.registrationDate, row.registrationDate]) || null;
    current.grade = joinDistinct([current.grade, row.grade]) || null;
    // O balde já é de UMA cor: o rótulo só é completado se o 1o membro veio sem descrição.
    if (!current.descCorProduto && cor.label) current.descCorProduto = cor.label;
    current.groupedMembers = buildGroupedMembers(
      [...(current.groupedMembers ?? []), incomingMember],
      groupByCor
    );
  }

  for (const row of aggregated.values()) {
    if (!row.isGroupedProduct) continue;
    const previousRevenue = Number(row._groupPreviousRevenue ?? 0);
    const previousQuantity = Number(row._groupPreviousQuantity ?? 0);
    row.revenueVariance = computeVariance(row.totalRevenue, previousRevenue);
    row.quantityVariance = computeVariance(row.totalQuantity, previousQuantity);
    row.isNew = previousRevenue <= 0 && row.totalRevenue > 0;
    row.stock = resolveGroupStock(
      Number(row._groupPositiveStock ?? 0),
      Number(row._groupNegativeStock ?? 0)
    );
    row.estoqueRede = resolveGroupStock(
      Number(row._groupPositiveEstoqueRede ?? 0),
      Number(row._groupNegativeEstoqueRede ?? 0)
    );
  }

  return Array.from(aggregated.values())
    .map(({
      _groupPreviousRevenue: _ignoreRevenue,
      _groupPreviousQuantity: _ignoreQuantity,
      _groupPositiveStock: _ignorePosStock,
      _groupNegativeStock: _ignoreNegStock,
      _groupPositiveEstoqueRede: _ignorePosRede,
      _groupNegativeEstoqueRede: _ignoreNegRede,
      ...row
    }) => row)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export function aggregateFilialProdutoSalesWithGroups(
  rows: FilialProdutoSalesRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: ProdutoAgrupadoAggregationOptions
): FilialProdutoSalesRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const corLookup = options?.corDescricoes ?? null;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, FilialProdutoSalesRow>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    if (!group) {
      aggregated.set(buildSalesRowKey(row, groupByCor), { ...row });
      continue;
    }

    const cor = groupByCor
      ? resolveProdutoAgrupadoCor(row.produto, row.cor, row.corDescricao, corLookup)
      : { key: "", label: "" };
    const key = buildGroupAggregationKey(group.id, cor.key);
    const syntheticId = buildProdutoAgrupadoSyntheticId(group.id);
    const incomingMember: ProdutoAgrupadoMember = {
      produto: row.produto,
      cor: String(row.cor ?? "").trim(),
      descricao: row.descricao,
      corDescricao: row.corDescricao ?? "",
      vendas: Number(row.vendas ?? 0),
      qtde: Number(row.qtde ?? 0),
      averagePrice: Number(row.qtde ?? 0) > 0 ? Number(row.vendas ?? 0) / Number(row.qtde ?? 0) : 0,
      cost: Number(row.custo ?? 0),
      markup:
        Number(row.custo ?? 0) > 0 && Number(row.qtde ?? 0) > 0
          ? (Number(row.vendas ?? 0) / Number(row.qtde ?? 0)) / Number(row.custo ?? 0)
          : 0,
    };
    const current = aggregated.get(key);

    if (!current) {
      aggregated.set(key, {
        ...row,
        produto: syntheticId,
        descricao: group.nome,
        cor: cor.key,
        corDescricao: cor.label,
        isGroupedProduct: true,
        groupId: group.id,
        groupedMembers: buildGroupedMembersWithSales([incomingMember], groupByCor),
      });
      continue;
    }

    const currentCostValue = Number(current.custo ?? 0) * Number(current.qtde ?? 0);
    const rowCostValue = Number(row.custo ?? 0) * Number(row.qtde ?? 0);
    const nextQtde = Number(current.qtde ?? 0) + Number(row.qtde ?? 0);
    const nextVendas = Number(current.vendas ?? 0) + Number(row.vendas ?? 0);

    current.vendas = nextVendas;
    current.qtde = nextQtde;
    current.vendasPrevious = Number(current.vendasPrevious ?? 0) + Number(row.vendasPrevious ?? 0);
    current.custo = computeWeightedAverage(currentCostValue + rowCostValue, nextQtde);
    current.codigoBarra = joinDistinct([current.codigoBarra, row.codigoBarra]);
    current.grade = joinDistinct([current.grade, row.grade]);
    current.subgrupo = joinDistinct([current.subgrupo, row.subgrupo]);
    current.linha = joinDistinct([current.linha, row.linha]);
    current.tipoProduto = joinDistinct([current.tipoProduto, row.tipoProduto]);
    current.colecao = joinDistinct([current.colecao, row.colecao]);
    current.descColecao = joinDistinct([current.descColecao, row.descColecao]);
    // Por cor o balde já É de uma cor só: o rótulo do balde manda (não vira "AZUL / AZUL").
    current.corDescricao = groupByCor
      ? (current.corDescricao || cor.label)
      : joinDistinct([current.corDescricao, row.corDescricao]);
    current.groupedMembers = buildGroupedMembersWithSales(
      [...(current.groupedMembers ?? []), incomingMember],
      groupByCor
    );
  }

  return Array.from(aggregated.values()).sort((a, b) => b.vendas - a.vendas);
}

export function aggregateProdutoQtdePorFilialWithGroups(
  rows: ProdutoQtdePorFilialRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: ProdutoAgrupadoAggregationOptions
): ProdutoQtdePorFilialRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const corLookup = options?.corDescricoes ?? null;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProdutoQtdePorFilialRow>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    const nextRow = group
      ? {
          ...row,
          produto: buildProdutoAgrupadoSyntheticId(group.id),
          // Mesma chave de cor emitida pelas outras agregações — é por ela que a
          // Curva ABC casa vendas x qtde por filial x estoque por filial.
          cor: groupByCor
            // Estas linhas não trazem descrição de cor: quem resolve é o cadastro (corLookup).
            ? resolveProdutoAgrupadoCor(row.produto, row.cor, null, corLookup).key
            : "",
        }
      : { ...row };
    const key = buildQtdeRowKey(nextRow, groupByCor);
    const current = aggregated.get(key);
    if (current) {
      current.qtde += Number(nextRow.qtde ?? 0);
      current.vendas = Number(current.vendas ?? 0) + Number(nextRow.vendas ?? 0);
    } else {
      aggregated.set(key, nextRow);
    }
  }

  return Array.from(aggregated.values());
}

export function aggregateProdutoEstoquePorFilialWithGroups(
  rows: ProdutoEstoquePorFilialRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: ProdutoAgrupadoAggregationOptions
): ProdutoEstoquePorFilialRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const corLookup = options?.corDescricoes ?? null;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProdutoEstoquePorFilialRow>();
  // Positivos e negativos separados por (grupo, cor, filial): o negativo de um
  // membro NUNCA come o positivo de outro dentro da mesma loja.
  const saldos = new Map<string, { positivo: number; negativo: number }>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    const nextRow = group
      ? {
          ...row,
          produto: buildProdutoAgrupadoSyntheticId(group.id),
          cor: groupByCor
            // Estas linhas não trazem descrição de cor: quem resolve é o cadastro (corLookup).
            ? resolveProdutoAgrupadoCor(row.produto, row.cor, null, corLookup).key
            : "",
        }
      : { ...row };
    const key = buildEstoqueRowKey(nextRow, groupByCor);
    const estoque = Number(nextRow.estoque ?? 0);
    const saldo = saldos.get(key) ?? { positivo: 0, negativo: 0 };
    saldo.positivo += Math.max(0, estoque);
    saldo.negativo += Math.min(0, estoque);
    saldos.set(key, saldo);

    if (!aggregated.has(key)) {
      aggregated.set(key, nextRow);
    }
  }

  for (const [key, row] of aggregated) {
    const saldo = saldos.get(key);
    if (!saldo) continue;
    row.estoque = resolveGroupStock(saldo.positivo, saldo.negativo);
  }

  return Array.from(aggregated.values());
}
