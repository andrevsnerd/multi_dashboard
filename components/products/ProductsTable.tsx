"use client";

import { useMemo, useState } from "react";
import type { ProductDetail } from "@/lib/repositories/products";

import styles from "./ProductsTable.module.css";

interface ProductsTableProps {
  data: ProductDetail[];
  loading?: boolean;
}

export default function ProductsTable({
  data,
  loading,
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

  const formatPercentage = (value: number | null) => {
    if (value === null) return null;
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
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
            </tr>
          </thead>
          <tbody>
            {sortedData.map((product, index) => {
              const revenueVariance = formatPercentage(product.revenueVariance);
              const isRevenuePositive = product.revenueVariance !== null && product.revenueVariance > 0;
              const isRevenueNegative = product.revenueVariance !== null && product.revenueVariance < 0;

              return (
                <tr key={`${product.productId}-${index}`}>
                  <td className={styles.descriptionCell}>
                    <div className={styles.productName}>{product.productName}</div>
                    <div className={styles.productCode}>{product.productId}</div>
                  </td>
                  <td className={styles.currencyCell}>{formatCurrency(product.totalRevenue)}</td>
                  <td className={styles.varianceCell}>
                    {product.isNew ? (
                      <span className={styles.newBadge}>NOVO</span>
                    ) : revenueVariance ? (
                      <span
                        className={`${styles.varianceValue} ${
                          isRevenuePositive
                            ? styles.variancePositive
                            : isRevenueNegative
                              ? styles.varianceNegative
                              : ""
                        }`}
                      >
                        {isRevenuePositive && "↑"}
                        {isRevenueNegative && "↓"}
                        {revenueVariance}
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td className={styles.numberCell}>{formatNumber(product.totalQuantity)}</td>
                  <td className={styles.currencyCell}>{formatCurrency(product.averagePrice)}</td>
                  <td className={styles.currencyCell}>{formatCurrency(product.cost)}</td>
                  <td className={styles.markupCell}>
                    <span className={styles.markupValue}>{formatMarkup(product.markup)}</span>
                  </td>
                  <td className={styles.numberCell}>{formatNumber(product.stock)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

