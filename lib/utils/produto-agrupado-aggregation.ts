import type { FilialProdutoSalesRow, ProdutoEstoquePorFilialRow, ProdutoQtdePorFilialRow } from "@/lib/repositories/performance";
import type { ProductDetail } from "@/lib/repositories/products";

import {
  buildProdutoAgrupadoLookup,
  buildProdutoAgrupadoProductKey,
  buildProdutoAgrupadoSyntheticId,
  type ProdutoAgrupadoGroup,
  type ProdutoAgrupadoMember,
} from "@/lib/utils/produtos-agrupados";

type ProductDetailAccumulator = ProductDetail & {
  _groupPreviousRevenue?: number;
  _groupPreviousQuantity?: number;
};

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

function buildProductDetailKey(row: ProductDetail, groupByColor: boolean): string {
  const cor = groupByColor ? (row.corProduto ?? "").trim() : "";
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

function buildGroupAggregationKey(groupId: string, cor: string): string {
  return `${buildProdutoAgrupadoSyntheticId(groupId)}||${cor}`;
}

function buildGroupedMembers(members: ProdutoAgrupadoMember[]): ProdutoAgrupadoMember[] {
  const unique = new Map<string, ProdutoAgrupadoMember>();
  for (const member of members) {
    const key = `${buildProdutoAgrupadoProductKey(member.produto)}||${member.cor.trim().toUpperCase()}`;
    if (!unique.has(key)) {
      unique.set(key, member);
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

export function aggregateProductDetailsWithGroups(
  rows: ProductDetail[],
  groups: ProdutoAgrupadoGroup[],
  options?: { groupByColor?: boolean }
): ProductDetail[] {
  if (groups.length === 0) return rows;

  const groupByColor = options?.groupByColor === true;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProductDetailAccumulator>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.productId));
    if (!group) {
      aggregated.set(buildProductDetailKey(row, groupByColor), { ...row });
      continue;
    }

    // Grouped products always consolidate into one entry regardless of color
    const key = buildGroupAggregationKey(group.id, "");
    const syntheticId = buildProdutoAgrupadoSyntheticId(group.id);
    const incomingMember: ProdutoAgrupadoMember = {
      produto: row.productId,
      cor: String(row.corProduto ?? "").trim(),
      descricao: row.productName,
      corDescricao: row.descCorProduto ?? "",
    };
    const current = aggregated.get(key);

    if (!current) {
      aggregated.set(key, {
        ...row,
        productId: syntheticId,
        productName: group.nome,
        corProduto: "",
        descCorProduto: "",
        cost: Number(row.cost ?? 0),
        averagePrice: Number(row.averagePrice ?? 0),
        markup: Number(row.markup ?? 0),
        suggestedPrice: row.suggestedPrice ?? null,
        isGroupedProduct: true,
        groupId: group.id,
        groupedMembers: buildGroupedMembers([incomingMember]),
        _groupPreviousRevenue: estimatePreviousValueFromVariance(row.totalRevenue, row.revenueVariance),
        _groupPreviousQuantity: estimatePreviousValueFromVariance(row.totalQuantity, row.quantityVariance),
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
    current.stock = Number(current.stock ?? 0) + Number(row.stock ?? 0);
    current.estoqueRede = Number(current.estoqueRede ?? 0) + Number(row.estoqueRede ?? 0);
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
    current.revenueVariance = computeVariance(
      current.totalRevenue,
      Number(current._groupPreviousRevenue ?? 0)
    );
    current.quantityVariance = computeVariance(
      current.totalQuantity,
      Number(current._groupPreviousQuantity ?? 0)
    );
    current.isNew = Number(current._groupPreviousRevenue ?? 0) <= 0 && current.totalRevenue > 0;
    current.registrationDate = joinDistinct([current.registrationDate, row.registrationDate]) || null;
    current.grade = joinDistinct([current.grade, row.grade]) || null;
    current.groupedMembers = buildGroupedMembers([...(current.groupedMembers ?? []), incomingMember]);
  }

  for (const row of aggregated.values()) {
    if (!row.isGroupedProduct) continue;
    const previousRevenue = Number(row._groupPreviousRevenue ?? 0);
    const previousQuantity = Number(row._groupPreviousQuantity ?? 0);
    row.revenueVariance = computeVariance(row.totalRevenue, previousRevenue);
    row.quantityVariance = computeVariance(row.totalQuantity, previousQuantity);
    row.isNew = previousRevenue <= 0 && row.totalRevenue > 0;
    delete row._groupPreviousRevenue;
    delete row._groupPreviousQuantity;
  }

  return Array.from(aggregated.values())
    .map(({ _groupPreviousRevenue: _ignoreRevenue, _groupPreviousQuantity: _ignoreQuantity, ...row }) => row)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export function aggregateFilialProdutoSalesWithGroups(
  rows: FilialProdutoSalesRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: { groupByCor?: boolean }
): FilialProdutoSalesRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, FilialProdutoSalesRow>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    if (!group) {
      aggregated.set(buildSalesRowKey(row, groupByCor), { ...row });
      continue;
    }

    // Grouped products always consolidate into one entry regardless of color
    const key = buildGroupAggregationKey(group.id, "");
    const syntheticId = buildProdutoAgrupadoSyntheticId(group.id);
    const incomingMember: ProdutoAgrupadoMember = {
      produto: row.produto,
      cor: String(row.cor ?? "").trim(),
      descricao: row.descricao,
      corDescricao: row.corDescricao ?? "",
    };
    const current = aggregated.get(key);

    if (!current) {
      aggregated.set(key, {
        ...row,
        produto: syntheticId,
        descricao: group.nome,
        cor: "",
        corDescricao: "",
        isGroupedProduct: true,
        groupId: group.id,
        groupedMembers: buildGroupedMembers([incomingMember]),
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
    current.corDescricao = joinDistinct([current.corDescricao, row.corDescricao]);
    current.groupedMembers = buildGroupedMembers([...(current.groupedMembers ?? []), incomingMember]);
  }

  return Array.from(aggregated.values()).sort((a, b) => b.vendas - a.vendas);
}

export function aggregateProdutoQtdePorFilialWithGroups(
  rows: ProdutoQtdePorFilialRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: { groupByCor?: boolean }
): ProdutoQtdePorFilialRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProdutoQtdePorFilialRow>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    const nextRow = group
      ? {
          ...row,
          produto: buildProdutoAgrupadoSyntheticId(group.id),
          cor: "", // Groups always consolidate regardless of color
        }
      : { ...row };
    const key = buildQtdeRowKey(nextRow, groupByCor);
    const current = aggregated.get(key);
    if (current) {
      current.qtde += Number(nextRow.qtde ?? 0);
    } else {
      aggregated.set(key, nextRow);
    }
  }

  return Array.from(aggregated.values());
}

export function aggregateProdutoEstoquePorFilialWithGroups(
  rows: ProdutoEstoquePorFilialRow[],
  groups: ProdutoAgrupadoGroup[],
  options?: { groupByCor?: boolean }
): ProdutoEstoquePorFilialRow[] {
  if (groups.length === 0) return rows;

  const groupByCor = options?.groupByCor === true;
  const lookup = buildProdutoAgrupadoLookup(groups);
  const aggregated = new Map<string, ProdutoEstoquePorFilialRow>();

  for (const row of rows) {
    const group = lookup.get(buildProdutoAgrupadoProductKey(row.produto));
    const nextRow = group
      ? {
          ...row,
          produto: buildProdutoAgrupadoSyntheticId(group.id),
          cor: "", // Groups always consolidate regardless of color
        }
      : { ...row };
    const key = buildEstoqueRowKey(nextRow, groupByCor);
    const current = aggregated.get(key);
    if (current) {
      current.estoque += Number(nextRow.estoque ?? 0);
    } else {
      aggregated.set(key, nextRow);
    }
  }

  return Array.from(aggregated.values());
}
