"use client";

import { useMemo, useState, useCallback, type ReactNode } from "react";
import type { ProductDetail } from "@/lib/repositories/products";

import styles from "./ProductsTable.module.css";

interface ProductsTableProps {
  data: ProductDetail[];
  loading?: boolean;
  groupByColor?: boolean;
  companyKey?: string;
  acimaDoTicket?: boolean;
  selectedFilial?: string | null;
}

interface ProductStockByFilialTooltipItem {
  filial: string;
  filialDisplayName: string;
  stock: number;
}

interface GroupedProductMemberDisplay {
  produto: string;
  descricao: string;
  vendas: number;
  qtde: number;
  averagePrice: number;
  cost: number;
  markup: number;
  stock: number;
  estoqueRede: number;
  colors: string[];
  colorLabels: string[];
}

const NO_COLOR_PARAM = "__SEM_COR__";
type SortableColumn =
  | "productName"
  | "totalRevenue"
  | "totalQuantity"
  | "averagePrice"
  | "cost"
  | "markup"
  | "stock"
  | "estoqueRede";

function getSortableValue(product: ProductDetail, column: SortableColumn): number | string {
  switch (column) {
    case "productName":
      return product.productName ?? "";
    case "totalRevenue":
      return Number(product.totalRevenue ?? 0);
    case "totalQuantity":
      return Number(product.totalQuantity ?? 0);
    case "averagePrice":
      return Number(product.averagePrice ?? 0);
    case "cost":
      return Number(product.cost ?? 0);
    case "markup":
      return Number(product.markup ?? 0);
    case "stock":
      return Number(product.stock ?? 0);
    case "estoqueRede":
      return Number(product.estoqueRede ?? 0);
    default:
      return 0;
  }
}

function computeWeightedAverage(totalValue: number, totalQuantity: number): number {
  if (!Number.isFinite(totalValue) || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
    return 0;
  }

  return totalValue / totalQuantity;
}

function parseGroupedMemberColors(value?: string | null): string[] {
  return String(value ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatGroupedMemberColors(colors: string[]): string {
  return Array.from(new Set(colors.map((item) => item.trim()).filter(Boolean))).join(" / ");
}

function getGroupedProductColorLabel(members: GroupedProductMemberDisplay[]): string {
  return formatGroupedMemberColors(members.flatMap((member) => member.colorLabels));
}

function formatGroupedMemberShortName(value?: string | null): string {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  return words.slice(0, 2).join(" ");
}

function getGroupedProductMembers(product: ProductDetail): GroupedProductMemberDisplay[] {
  const aggregated = new Map<string, GroupedProductMemberDisplay>();

  (product.groupedMembers ?? []).forEach((member) => {
    const key = String(member.produto ?? "").trim();
    if (!key) return;

    const revenue = Number(member.vendas ?? 0);
    const quantity = Number(member.qtde ?? 0);
    const averagePrice = Number(
      member.averagePrice ?? computeWeightedAverage(revenue, quantity)
    );
    const cost = Number(member.cost ?? 0);
    const stock = Number(member.stock ?? 0);
    const estoqueRede = Number(member.estoqueRede ?? 0);
    const colors = parseGroupedMemberColors(member.cor);
    const colorLabels = parseGroupedMemberColors(member.corDescricao || member.cor);
    const current = aggregated.get(key);

    if (!current) {
      aggregated.set(key, {
        produto: key,
        descricao: member.descricao || key,
        vendas: revenue,
        qtde: quantity,
        averagePrice,
        cost,
        markup: cost > 0 ? averagePrice / cost : Number(member.markup ?? 0),
        stock,
        estoqueRede,
        colors,
        colorLabels,
      });
      return;
    }

    const nextRevenue = current.vendas + revenue;
    const nextQuantity = current.qtde + quantity;
    const currentCostValue = current.cost * current.qtde;
    const nextCostValue = cost * quantity;

    current.descricao = current.descricao || member.descricao || key;
    current.vendas = nextRevenue;
    current.qtde = nextQuantity;
    current.averagePrice = computeWeightedAverage(nextRevenue, nextQuantity);
    current.cost = computeWeightedAverage(currentCostValue + nextCostValue, nextQuantity);
    current.markup = current.cost > 0 ? current.averagePrice / current.cost : 0;
    current.stock += stock;
    current.estoqueRede += estoqueRede;
    current.colors = Array.from(new Set([...current.colors, ...colors]));
    current.colorLabels = Array.from(new Set([...current.colorLabels, ...colorLabels]));
  });

  return Array.from(aggregated.values()).sort(
    (a, b) => b.vendas - a.vendas || a.descricao.localeCompare(b.descricao, "pt-BR")
  );
}

export default function ProductsTable({
  data,
  loading,
  groupByColor = false,
  companyKey,
  acimaDoTicket = false,
  selectedFilial = null,
}: ProductsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortableColumn>("totalRevenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [hoveredStockKey, setHoveredStockKey] = useState<string | null>(null);
  const [stockTooltipCache, setStockTooltipCache] = useState<
    Record<string, ProductStockByFilialTooltipItem[]>
  >({});
  const [loadingStockTooltipKey, setLoadingStockTooltipKey] = useState<string | null>(null);
  const [stockTooltipErrors, setStockTooltipErrors] = useState<Record<string, string>>({});
  const [tooltipAnchorRect, setTooltipAnchorRect] = useState<DOMRect | null>(null);

  const buildStockTooltipKey = useCallback(
    (product: ProductDetail) =>
      `${product.productId}::${groupByColor ? product.corProduto ?? NO_COLOR_PARAM : "all"}`,
    [groupByColor]
  );

  const loadStockTooltip = useCallback(
    async (product: ProductDetail) => {
      if (!companyKey) {
        return;
      }

      const key = buildStockTooltipKey(product);
      if (stockTooltipCache[key] || loadingStockTooltipKey === key) {
        return;
      }

      setLoadingStockTooltipKey(key);
      setStockTooltipErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      try {
        const groupedMembers = getGroupedProductMembers(product);
        const requestEntries = product.isGroupedProduct
          ? groupedMembers.map((member) => ({
              productId: member.produto,
              colors: groupByColor ? member.colors : [],
            }))
          : companyKey === "scarfme"
            ? [{
                productId: product.productId,
                colors: groupByColor ? [product.corProduto ?? NO_COLOR_PARAM] : [],
              }]
            : [];

        if (requestEntries.length === 0) {
          return;
        }

        const responses = await Promise.all(
          requestEntries.map(async (entry) => {
            const searchParams = new URLSearchParams({
              productId: entry.productId,
              company: companyKey,
            });

            if (groupByColor && entry.colors.length > 0) {
              searchParams.set(
                "colors",
                entry.colors.map((color) => color || NO_COLOR_PARAM).join(",")
              );
            }

            const response = await fetch(`/api/products/stock-by-filial?${searchParams.toString()}`, {
              cache: "no-store",
            });

            if (!response.ok) {
              throw new Error("Nao foi possivel carregar as filiais");
            }

            const json = (await response.json()) as {
              data?: ProductStockByFilialTooltipItem[];
            };

            return json.data ?? [];
          })
        );

        const mergedByFilial = new Map<string, ProductStockByFilialTooltipItem>();
        responses.flat().forEach((item) => {
          const filial = String(item.filial ?? "").trim();
          const filialDisplayName = String(item.filialDisplayName ?? filial).trim();
          const stock = Number(item.stock ?? 0);
          if (!filial) return;

          const current = mergedByFilial.get(filial);
          if (current) {
            current.stock += stock;
            return;
          }

          mergedByFilial.set(filial, {
            filial,
            filialDisplayName,
            stock,
          });
        });

        const rows = Array.from(mergedByFilial.values())
          .filter((item) => Number(item.stock ?? 0) > 0)
          .sort((a, b) => Number(b.stock ?? 0) - Number(a.stock ?? 0));

        setStockTooltipCache((prev) => ({
          ...prev,
          [key]: rows,
        }));
      } catch (error) {
        setStockTooltipErrors((prev) => ({
          ...prev,
          [key]:
            error instanceof Error && error.message
              ? error.message
              : "Nao foi possivel carregar as filiais",
        }));
      } finally {
        setLoadingStockTooltipKey((current) => (current === key ? null : current));
      }
    },
    [buildStockTooltipKey, companyKey, groupByColor, loadingStockTooltipKey, stockTooltipCache]
  );

  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aValue = getSortableValue(a, sortColumn);
      const bValue = getSortableValue(b, sortColumn);
      
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      return sortDirection === "asc"
        ? String(aValue).localeCompare(String(bValue), "pt-BR")
        : String(bValue).localeCompare(String(aValue), "pt-BR");
    });
    
    return sorted;
  }, [data, sortColumn, sortDirection]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatNumber = (value: number) => {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const formatMarkup = (value: number) => {
    return `${value.toFixed(2)}x`;
  };

  const renderGroupedMetricTooltip = (
    product: ProductDetail,
    title: string,
    value: ReactNode,
    valueFormatter: (value: number) => string,
    valueSelector: (member: GroupedProductMemberDisplay) => number,
    totalValue?: number,
    alignRight: boolean = false
  ) => {
    const groupedMembers = getGroupedProductMembers(product);
    if (!product.isGroupedProduct || groupedMembers.length === 0) {
      return value;
    }

    return (
      <div className={styles.inlineTooltipWrapper}>
        <span className={styles.inlineTooltipTrigger}>{value}</span>
        <div
          className={`${styles.inlineTooltipPanel}${alignRight ? ` ${styles.inlineTooltipPanelRight}` : ""}`}
        >
          <div className={styles.inlineTooltipTitle}>{title}</div>
          <div className={styles.inlineTooltipList}>
            {groupedMembers.map((member) => (
              <div key={member.produto} className={styles.inlineTooltipRow}>
                <span className={styles.inlineTooltipLabel}>
                  {formatGroupedMemberShortName(member.descricao) || member.produto}
                  <span className={styles.inlineTooltipCode}>{member.produto}</span>
                  {member.colorLabels.length > 0 && (
                    <span className={styles.inlineTooltipMeta}>
                      {formatGroupedMemberColors(member.colorLabels)}
                    </span>
                  )}
                </span>
                <span className={styles.inlineTooltipValue}>
                  {valueFormatter(valueSelector(member))}
                </span>
              </div>
            ))}
          </div>
          {groupedMembers.length > 1 && typeof totalValue === "number" && (
            <div className={styles.inlineTooltipFooter}>
              <span>Total</span>
              <span>{valueFormatter(totalValue)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const showStockColumn = companyKey !== "scarfme" || Boolean(selectedFilial);
  const showStockRedeColumn = companyKey === "scarfme";

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhum produto encontrado</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Desktop: Tabela tradicional */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th
                className={`${styles.sortable} ${styles.descriptionHeader}`}
                onClick={() => handleSort("productName")}
              >
                DESCRICAO
                {sortColumn === "productName" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "^" : "v"}
                  </span>
                )}
              </th>
              {companyKey === "scarfme" && (
                <th className={styles.gradeHeader}>
                  GRADE
                </th>
              )}
              {groupByColor && (
                <th className={styles.descriptionHeader}>
                  COR
                </th>
              )}
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("totalRevenue")}
              >
                FATURAMENTO
                {sortColumn === "totalRevenue" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "^" : "v"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("totalQuantity")}
              >
                QTD
                {sortColumn === "totalQuantity" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "^" : "v"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("averagePrice")}
              >
                PRECO MEDIO
                {sortColumn === "averagePrice" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "^" : "v"}
                  </span>
                )}
              </th>
              {acimaDoTicket ? (
                <>
                  <th className={styles.currencyHeader}>
                    PRECO SUGERIDO
                  </th>
                  <th className={styles.currencyHeader}>
                    DIFERENCA
                  </th>
                  <th className={styles.currencyHeader}>
                    DIFERENCA TOTAL
                  </th>
                </>
              ) : null}
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("cost")}
              >
                CUSTO
                {sortColumn === "cost" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "^" : "v"}
                  </span>
                )}
              </th>
              {!acimaDoTicket && (
                <th
                  className={`${styles.sortable} ${styles.markupHeader}`}
                  onClick={() => handleSort("markup")}
                >
                  MARKUP
                  {sortColumn === "markup" && (
                    <span className={styles.sortIndicator}>
                      {sortDirection === "asc" ? "^" : "v"}
                    </span>
                  )}
                </th>
              )}
              {showStockColumn && (
                <th
                  className={`${styles.sortable} ${styles.numberHeader}`}
                  onClick={() => handleSort("stock")}
                >
                  ESTOQUE
                  {sortColumn === "stock" && (
                    <span className={styles.sortIndicator}>
                      {sortDirection === "asc" ? "^" : "v"}
                    </span>
                  )}
                </th>
              )}
              {showStockRedeColumn && (
                <th
                  className={`${styles.sortable} ${styles.numberHeader}`}
                  onClick={() => handleSort("estoqueRede")}
                >
                  ESTOQUE REDE
                  {sortColumn === "estoqueRede" && (
                    <span className={styles.sortIndicator}>
                      {sortDirection === "asc" ? "^" : "v"}
                    </span>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((product, index) => {
              const groupedMembers = getGroupedProductMembers(product);
              const groupedCodesLabel = product.isGroupedProduct
                ? groupedMembers.map((member) => member.produto).join(" / ")
                : product.productId;
              const groupedColorLabel = getGroupedProductColorLabel(groupedMembers);
              const shouldShowGroupedStockTooltip = product.isGroupedProduct && groupedMembers.length > 0;
              const stockTooltipKey = buildStockTooltipKey(product);
              const stockCellTooltipKey = `${stockTooltipKey}::stock`;
              const stockRedeCellTooltipKey = `${stockTooltipKey}::rede`;
              const stockTooltipRows = stockTooltipCache[stockTooltipKey] ?? [];
              const stockTooltipTotal = stockTooltipRows.reduce(
                (sum, item) => sum + Number(item.stock ?? 0),
                0
              );
              const stockTooltipVisible = hoveredStockKey === stockCellTooltipKey;
              const stockRedeTooltipVisible = hoveredStockKey === stockRedeCellTooltipKey;
              const stockTooltipLoading = loadingStockTooltipKey === stockTooltipKey;
              const stockTooltipError = stockTooltipErrors[stockTooltipKey];

              return (
                <tr key={`${product.productId}-${product.corProduto || ''}-${index}`}>
                  <td className={styles.descriptionCell}>
                    <div className={styles.productName}>{product.productName}</div>
                    {product.isGroupedProduct && groupedMembers.length > 0 ? (
                      <div className={styles.inlineTooltipWrapper}>
                        <div className={`${styles.productCode} ${styles.inlineTooltipTrigger}`}>
                          {groupedCodesLabel}
                        </div>
                        <div className={styles.inlineTooltipPanel}>
                          <div className={styles.inlineTooltipTitle}>Produtos do grupo</div>
                          <div className={styles.inlineTooltipList}>
                            {groupedMembers.map((member) => (
                              <div key={member.produto} className={styles.inlineTooltipRow}>
                                <span className={styles.inlineTooltipLabel}>
                                  {member.descricao || member.produto}
                                  <span className={styles.inlineTooltipCode}>{member.produto}</span>
                                  {member.colorLabels.length > 0 && (
                                    <span className={styles.inlineTooltipMeta}>
                                      {formatGroupedMemberColors(member.colorLabels)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.productCode}>{groupedCodesLabel}</div>
                    )}
                  </td>
                  {companyKey === "scarfme" && (
                    <td className={styles.gradeCell}>
                      {product.grade || '--'}
                    </td>
                  )}
                  {groupByColor && (
                    <td className={styles.descriptionCell}>
                      {product.isGroupedProduct
                        ? groupedColorLabel || '--'
                        : product.descCorProduto || '--'}
                    </td>
                  )}
                  <td className={styles.currencyCell}>
                    {renderGroupedMetricTooltip(
                      product,
                      "Faturamento por produto",
                      formatCurrency(product.totalRevenue),
                      formatCurrency,
                      (member) => member.vendas,
                      product.totalRevenue,
                      true
                    )}
                  </td>
                  <td className={styles.numberCell}>
                    {renderGroupedMetricTooltip(
                      product,
                      "Quantidade por produto",
                      formatNumber(product.totalQuantity),
                      formatNumber,
                      (member) => member.qtde,
                      product.totalQuantity,
                      true
                    )}
                  </td>
                  <td className={styles.currencyCell}>
                    {renderGroupedMetricTooltip(
                      product,
                      "Preco medio por produto",
                      formatCurrency(product.averagePrice),
                      formatCurrency,
                      (member) => member.averagePrice
                    )}
                  </td>
                  {acimaDoTicket ? (
                    <>
                      <td className={styles.currencyCell}>
                        {product.suggestedPrice ? formatCurrency(product.suggestedPrice) : '--'}
                      </td>
                      <td className={styles.currencyCell}>
                        {product.suggestedPrice
                          ? formatCurrency(product.averagePrice - product.suggestedPrice)
                          : '--'}
                      </td>
                      <td className={styles.currencyCell}>
                        {product.suggestedPrice
                          ? formatCurrency((product.averagePrice - product.suggestedPrice) * product.totalQuantity)
                          : '--'}
                      </td>
                    </>
                  ) : null}
                  <td className={styles.currencyCell}>
                    {renderGroupedMetricTooltip(
                      product,
                      "Custo por produto",
                      formatCurrency(product.cost),
                      formatCurrency,
                      (member) => member.cost,
                      undefined,
                      true
                    )}
                  </td>
                  {!acimaDoTicket && (
                    <td className={styles.markupCell}>
                      {renderGroupedMetricTooltip(
                        product,
                        "Markup por produto",
                        <span className={styles.markupValue}>{formatMarkup(product.markup)}</span>,
                        formatMarkup,
                        (member) => member.markup,
                        undefined,
                        true
                      )}
                    </td>
                  )}
                  {showStockColumn && (
                    <td className={styles.numberCell}>
                      {shouldShowGroupedStockTooltip ? (
                        <div
                          className={styles.stockTooltipAnchor}
                          onMouseEnter={(e) => {
                            setTooltipAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                            setHoveredStockKey(stockCellTooltipKey);
                            void loadStockTooltip(product);
                          }}
                          onMouseLeave={() => {
                            setHoveredStockKey((current) =>
                              current === stockCellTooltipKey ? null : current
                            );
                            setTooltipAnchorRect(null);
                          }}
                        >
                          <span className={styles.stockRedeValue}>{formatNumber(product.stock)}</span>
                          {stockTooltipVisible && tooltipAnchorRect && (
                            <div
                              className={styles.stockTooltipPanel}
                              style={{
                                position: "fixed",
                                bottom: window.innerHeight - tooltipAnchorRect.top + 8,
                                right: window.innerWidth - tooltipAnchorRect.right,
                                top: "unset",
                              }}
                            >
                              <div className={styles.stockTooltipHeader}>Estoque por filial</div>
                              {stockTooltipLoading ? (
                                <div className={styles.stockTooltipEmpty}>Carregando filiais...</div>
                              ) : stockTooltipError ? (
                                <div className={styles.stockTooltipEmpty}>{stockTooltipError}</div>
                              ) : stockTooltipRows.length > 0 ? (
                                <>
                                  <div className={styles.stockTooltipSubtitle}>
                                    {stockTooltipRows.length} filiais · {formatNumber(stockTooltipTotal)} unidades
                                  </div>
                                  <div className={styles.stockTooltipList}>
                                    {stockTooltipRows.map((item) => (
                                      <div
                                        key={`${item.filial}-${item.filialDisplayName}`}
                                        className={styles.stockTooltipRow}
                                      >
                                        <span className={styles.stockTooltipFilial}>
                                          {item.filialDisplayName}
                                        </span>
                                        <span className={styles.stockTooltipQty}>
                                          {formatNumber(item.stock)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <div className={styles.stockTooltipEmpty}>Sem estoque distribuido nas filiais.</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        formatNumber(product.stock)
                      )}
                    </td>
                  )}
                  {showStockRedeColumn && (
                    <td className={`${styles.numberCell} ${styles.stockRedeCell}`}>
                      <div
                        className={styles.stockTooltipAnchor}
                        onMouseEnter={(e) => {
                          if (!shouldShowGroupedStockTooltip && companyKey !== "scarfme") {
                            return;
                          }
                          setTooltipAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                          setHoveredStockKey(stockRedeCellTooltipKey);
                          void loadStockTooltip(product);
                        }}
                        onMouseLeave={() => {
                          setHoveredStockKey((current) =>
                            current === stockRedeCellTooltipKey ? null : current
                          );
                          setTooltipAnchorRect(null);
                        }}
                      >
                        <span className={styles.stockRedeValue}>
                          {product.estoqueRede !== undefined ? formatNumber(product.estoqueRede) : '--'}
                        </span>

                        {stockRedeTooltipVisible && tooltipAnchorRect && (
                          <div
                            className={styles.stockTooltipPanel}
                            style={{
                              position: "fixed",
                              bottom: window.innerHeight - tooltipAnchorRect.top + 8,
                              right: window.innerWidth - tooltipAnchorRect.right,
                              top: "unset",
                            }}
                          >
                            <div className={styles.stockTooltipHeader}>Estoque por filial</div>
                            {stockTooltipLoading ? (
                              <div className={styles.stockTooltipEmpty}>Carregando filiais...</div>
                            ) : stockTooltipError ? (
                              <div className={styles.stockTooltipEmpty}>{stockTooltipError}</div>
                            ) : stockTooltipRows.length > 0 ? (
                              <>
                                <div className={styles.stockTooltipSubtitle}>
                                  {stockTooltipRows.length} filiais · {formatNumber(stockTooltipTotal)} unidades
                                </div>
                                <div className={styles.stockTooltipList}>
                                  {stockTooltipRows.map((item) => (
                                    <div
                                      key={`${item.filial}-${item.filialDisplayName}`}
                                      className={styles.stockTooltipRow}
                                    >
                                      <span className={styles.stockTooltipFilial}>
                                        {item.filialDisplayName}
                                      </span>
                                      <span className={styles.stockTooltipQty}>
                                        {formatNumber(item.stock)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className={styles.stockTooltipEmpty}>Sem estoque distribuído nas filiais.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {sortedData.map((product, index) => {
            const groupedMembers = getGroupedProductMembers(product);
            const groupedCodesLabel = product.isGroupedProduct
              ? groupedMembers.map((member) => member.produto).join(" / ")
              : product.productId;
            const groupedColorLabel = getGroupedProductColorLabel(groupedMembers);
            return (
              <div key={`${product.productId}-${product.corProduto || ''}-${index}`} className={styles.card}>
                <div className={styles.cardMain}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardLeft}>
                      <div className={styles.cardProductInfo}>
                        <h4 className={styles.cardProductName}>
                          {product.productName}
                        </h4>
                        <div className={styles.cardProductMeta}>
                          <span className={styles.cardProductCode}>{groupedCodesLabel}</span>
                          {companyKey === "scarfme" && product.grade && (
                            <span className={styles.cardGrade}>{product.grade}</span>
                          )}
                          {groupByColor && (product.isGroupedProduct ? groupedColorLabel : product.descCorProduto) && (
                            <span className={styles.cardColor}>
                              {product.isGroupedProduct ? groupedColorLabel : product.descCorProduto}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={styles.cardRevenue}>
                        <span className={styles.cardRevenueValue}>
                          {formatCurrency(product.totalRevenue)}
                          <span className={styles.cardQuantity}> {formatNumber(product.totalQuantity)} unidades</span>
                        </span>
                      </div>
                    </div>
                    <div className={styles.cardRight}>
                      {product.isNew && (
                        <span className={styles.cardNewBadge}>NOVO</span>
                      )}
                      <div className={styles.cardStockBadges}>
                        {showStockColumn && (
                          <span className={styles.cardStock}>
                            {formatNumber(product.stock)} estoque
                          </span>
                        )}
                        {showStockRedeColumn && product.estoqueRede !== undefined && (
                          <span className={styles.cardStockRede}>
                            {formatNumber(product.estoqueRede)} rede
                          </span>
                        )}
                      </div>
                      <div className={styles.cardPriceInfo}>
                        <span className={styles.cardPriceItem}>
                          <span className={styles.cardPriceLabel}>Preco:</span> {formatCurrency(product.averagePrice)}
                        </span>
                        {acimaDoTicket && product.suggestedPrice ? (
                          <>
                            <span className={styles.cardPriceItem}>
                              <span className={styles.cardPriceLabel}>Preco Sugerido:</span> {formatCurrency(product.suggestedPrice)}
                            </span>
                            <span className={styles.cardPriceItem}>
                              <span className={styles.cardPriceLabel}>Diferenca:</span> {formatCurrency((product.averagePrice - product.suggestedPrice) * product.totalQuantity)}
                            </span>
                          </>
                        ) : (
                          <span className={styles.cardPriceItem}>
                            <span className={styles.cardPriceLabel}>Custo:</span> {formatCurrency(product.cost)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
