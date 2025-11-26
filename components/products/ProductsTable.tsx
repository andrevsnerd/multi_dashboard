"use client";

import { useMemo, useState } from "react";
import type { ProductDetail } from "@/lib/repositories/products";

import styles from "./ProductsTable.module.css";

interface ProductsTableProps {
  data: ProductDetail[];
  loading?: boolean;
  groupByColor?: boolean;
  companyKey?: string;
}

export default function ProductsTable({
  data,
  loading,
  groupByColor = false,
  companyKey,
}: ProductsTableProps) {
  const [sortColumn, setSortColumn] = useState<keyof ProductDetail>("totalRevenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = (column: keyof ProductDetail) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];
      
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }
      
      return 0;
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

  const formatVariance = (value: number | null, currentRevenue: number): {
    text: string;
    isPositive: boolean;
    isNegative: boolean;
    isNeutral: boolean;
  } => {
    if (value === null) {
      if (currentRevenue > 0) {
        return {
          text: "Novo",
          isPositive: true,
          isNegative: false,
          isNeutral: false,
        };
      } else {
        return {
          text: "--",
          isPositive: false,
          isNegative: false,
          isNeutral: true,
        };
      }
    }

    if (value === 0) {
      return {
        text: "0%",
        isPositive: false,
        isNegative: false,
        isNeutral: true,
      };
    }

    const isPositive = value > 0;
    const isNegative = value < 0;
    
    if (value === -100) {
      return {
        text: "Parou",
        isPositive: false,
        isNegative: true,
        isNeutral: false,
      };
    }

    return {
      text: `${isPositive ? "+" : ""}${value.toFixed(1)}%`,
      isPositive,
      isNegative,
      isNeutral: false,
    };
  };

  const formatMarkup = (value: number) => {
    return `${value.toFixed(2)}x`;
  };

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
                DESCRIÇÃO
                {sortColumn === "productName" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
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
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.varianceHeader}`}
                onClick={() => handleSort("revenueVariance")}
              >
                VAR. %
                {sortColumn === "revenueVariance" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
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
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("averagePrice")}
              >
                PREÇO MÉDIO
                {sortColumn === "averagePrice" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("cost")}
              >
                CUSTO
                {sortColumn === "cost" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.markupHeader}`}
                onClick={() => handleSort("markup")}
              >
                MARKUP
                {sortColumn === "markup" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("stock")}
              >
                ESTOQUE
                {sortColumn === "stock" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              {companyKey === "scarfme" && (
                <th
                  className={`${styles.sortable} ${styles.numberHeader}`}
                  onClick={() => handleSort("estoqueRede")}
                >
                  ESTOQUE REDE
                  {sortColumn === "estoqueRede" && (
                    <span className={styles.sortIndicator}>
                      {sortDirection === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((product, index) => {
              return (
                <tr key={`${product.productId}-${product.corProduto || ''}-${index}`}>
                  <td className={styles.descriptionCell}>
                    <div className={styles.productName}>{product.productName}</div>
                    <div className={styles.productCode}>{product.productId}</div>
                  </td>
                  {companyKey === "scarfme" && (
                    <td className={styles.gradeCell}>
                      {product.grade || '--'}
                    </td>
                  )}
                  {groupByColor && (
                    <td className={styles.descriptionCell}>
                      {product.descCorProduto || '--'}
                    </td>
                  )}
                  <td className={styles.currencyCell}>{formatCurrency(product.totalRevenue)}</td>
                  <td className={styles.varianceCell}>
                    {product.isNew ? (
                      <span className={styles.newBadge}>NOVO</span>
                    ) : (() => {
                      const variance = formatVariance(product.revenueVariance, product.totalRevenue);
                      return variance.text !== "--" ? (
                        <span
                          className={`${styles.varianceValue} ${
                            variance.isPositive
                              ? styles.variancePositive
                              : variance.isNegative
                                ? styles.varianceNegative
                                : styles.varianceNeutral
                          }`}
                        >
                          {variance.isPositive && "↑"}
                          {variance.isNegative && "↓"}
                          {variance.text}
                        </span>
                      ) : (
                        "--"
                      );
                    })()}
                  </td>
                  <td className={styles.numberCell}>{formatNumber(product.totalQuantity)}</td>
                  <td className={styles.currencyCell}>{formatCurrency(product.averagePrice)}</td>
                  <td className={styles.currencyCell}>{formatCurrency(product.cost)}</td>
                  <td className={styles.markupCell}>
                    <span className={styles.markupValue}>{formatMarkup(product.markup)}</span>
                  </td>
                  <td className={styles.numberCell}>{formatNumber(product.stock)}</td>
                  {companyKey === "scarfme" && (
                    <td className={styles.numberCell}>
                      {product.estoqueRede !== undefined ? formatNumber(product.estoqueRede) : '--'}
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
            const variance = formatVariance(product.revenueVariance, product.totalRevenue);

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
                          <span className={styles.cardProductCode}>{product.productId}</span>
                          {companyKey === "scarfme" && product.grade && (
                            <span className={styles.cardGrade}>{product.grade}</span>
                          )}
                          {groupByColor && product.descCorProduto && (
                            <span className={styles.cardColor}>{product.descCorProduto}</span>
                          )}
                          {!product.isNew && (
                            <span
                              className={`${styles.cardVariance} ${
                                variance.isPositive
                                  ? styles.variancePositive
                                  : variance.isNegative
                                    ? styles.varianceNegative
                                    : styles.varianceNeutral
                              }`}
                            >
                              {variance.text}
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
                        <span className={styles.cardStock}>
                          {formatNumber(product.stock)} estoque
                        </span>
                        {companyKey === "scarfme" && product.estoqueRede !== undefined && (
                          <span className={styles.cardStockRede}>
                            {formatNumber(product.estoqueRede)} rede
                          </span>
                        )}
                      </div>
                      <div className={styles.cardPriceInfo}>
                        <span className={styles.cardPriceItem}>
                          <span className={styles.cardPriceLabel}>Preço:</span> {formatCurrency(product.averagePrice)}
                        </span>
                        <span className={styles.cardPriceItem}>
                          <span className={styles.cardPriceLabel}>Custo:</span> {formatCurrency(product.cost)}
                        </span>
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

