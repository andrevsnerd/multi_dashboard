"use client";

import { useMemo, useState } from "react";
import type { ProductDetail } from "@/lib/repositories/products";
import { useAuth } from "@/components/auth/AuthContext";
import { canSeeCusto } from "@/lib/auth/permissions";

import styles from "./ProductsTable.module.css";

interface ProductsRecentTableProps {
  data: ProductDetail[];
  loading?: boolean;
  groupByColor?: boolean;
  companyKey?: string;
  selectedFilial?: string | null;
}

export default function ProductsRecentTable({
  data,
  loading,
  groupByColor = false,
  companyKey,
  selectedFilial = null,
}: ProductsRecentTableProps) {
  const { user } = useAuth();
  const podeVerCusto = canSeeCusto(user);
  const [sortColumn, setSortColumn] = useState<keyof ProductDetail | "registrationDate">("registrationDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = (column: keyof ProductDetail | "registrationDate") => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let aValue: unknown;
      let bValue: unknown;

      if (sortColumn === "registrationDate") {
        aValue = a.registrationDate ? new Date(a.registrationDate).getTime() : 0;
        bValue = b.registrationDate ? new Date(b.registrationDate).getTime() : 0;
      } else {
        aValue = a[sortColumn as keyof ProductDetail];
        bValue = b[sortColumn as keyof ProductDetail];
      }

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      return 0;
    });

    return sorted;
  }, [data, sortColumn, sortDirection]);

  const formatCurrency = (value: number | null | undefined) => {
    if (value == null) return "R$ 0,00";
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatNumber = (value: number | null | undefined) => {
    if (value == null) return "0";
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "--";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "--";
    }
  };

  const formatMarkup = (value: number | null | undefined) => {
    if (value == null) return "0,00x";
    return `${value.toFixed(2)}x`;
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
        <table className={styles.table}>
          <thead>
            <tr>
              <th
                className={`${styles.sortable} ${styles.descriptionHeader}`}
                onClick={() => handleSort("registrationDate")}
              >
                DATA CADASTRO
                {sortColumn === "registrationDate" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.descriptionHeader}`}
                onClick={() => handleSort("productName")}
              >
                DESCRICAO
                {sortColumn === "productName" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              {companyKey === "scarfme" && <th className={styles.gradeHeader}>GRADE</th>}
              {groupByColor && <th className={styles.descriptionHeader}>COR</th>}
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("totalRevenue")}
              >
                FATURAMENTO
                {sortColumn === "totalRevenue" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("totalQuantity")}
              >
                QTD
                {sortColumn === "totalQuantity" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("averagePrice")}
              >
                PRECO MEDIO
                {sortColumn === "averagePrice" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              {podeVerCusto && (
                <th
                  className={`${styles.sortable} ${styles.currencyHeader}`}
                  onClick={() => handleSort("cost")}
                >
                  CUSTO
                  {sortColumn === "cost" && (
                    <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                  )}
                </th>
              )}
              <th
                className={`${styles.sortable} ${styles.markupHeader}`}
                onClick={() => handleSort("markup")}
              >
                MARKUP
                {sortColumn === "markup" && (
                  <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                )}
              </th>
              {showStockColumn && (
                <th
                  className={`${styles.sortable} ${styles.numberHeader}`}
                  onClick={() => handleSort("stock")}
                >
                  ESTOQUE
                  {sortColumn === "stock" && (
                    <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
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
                    <span className={styles.sortIndicator}>{sortDirection === "asc" ? "^" : "v"}</span>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((product, index) => {
              const hasNoSale = product.totalRevenue === 0 && product.totalQuantity === 0;

              return (
                <tr
                  key={`${product.productId}-${product.corProduto || ""}-${index}`}
                  className={hasNoSale ? styles.noSaleRow : ""}
                >
                  <td className={styles.descriptionCell}>{formatDate(product.registrationDate)}</td>
                  <td className={styles.descriptionCell}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.productName}>{product.productName}</div>
                        <div className={styles.productCode}>{product.productId}</div>
                      </div>
                      {hasNoSale && (
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 600,
                            color: "#991b1b",
                            background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            letterSpacing: "0.5px",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                            boxShadow: "0 1px 2px rgba(220, 38, 38, 0.1)",
                            alignSelf: "flex-start",
                            marginTop: "2px",
                          }}
                        >
                          Sem venda
                        </span>
                      )}
                    </div>
                  </td>
                  {companyKey === "scarfme" && <td className={styles.gradeCell}>{product.grade || "--"}</td>}
                  {groupByColor && <td className={styles.descriptionCell}>{product.descCorProduto || "--"}</td>}
                  <td className={styles.currencyCell}>{formatCurrency(product.totalRevenue)}</td>
                  <td className={styles.numberCell}>{formatNumber(product.totalQuantity)}</td>
                  <td className={styles.currencyCell}>{formatCurrency(product.averagePrice)}</td>
                  {podeVerCusto && <td className={styles.currencyCell}>{formatCurrency(product.cost)}</td>}
                  <td className={styles.markupCell}>
                    <span className={styles.markupValue}>{formatMarkup(product.markup)}</span>
                  </td>
                  {showStockColumn && <td className={styles.numberCell}>{formatNumber(product.stock)}</td>}
                  {showStockRedeColumn && (
                    <td className={styles.numberCell}>
                      {product.estoqueRede !== undefined ? formatNumber(product.estoqueRede) : "--"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.mobileCards}>
          {sortedData.map((product, index) => {
            const hasNoSale = product.totalRevenue === 0 && product.totalQuantity === 0;

            return (
              <div
                key={`${product.productId}-${product.corProduto || ""}-${index}`}
                className={`${styles.card} ${hasNoSale ? styles.noSaleCard : ""}`}
              >
                <div className={styles.cardMain}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardLeft}>
                      <div className={styles.cardProductInfo}>
                        <div className={styles.cardProductMeta}>
                          <span className={styles.cardDate}>{formatDate(product.registrationDate)}</span>
                        </div>
                        <h4 className={styles.cardProductName}>{product.productName}</h4>
                        <div className={styles.cardProductMeta}>
                          <span className={styles.cardProductCode}>{product.productId}</span>
                          {companyKey === "scarfme" && product.grade && (
                            <span className={styles.cardGrade}>{product.grade}</span>
                          )}
                          {groupByColor && product.descCorProduto && (
                            <span className={styles.cardColor}>{product.descCorProduto}</span>
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
                      {product.isNew && <span className={styles.cardNewBadge}>NOVO</span>}
                      <div className={styles.cardStockBadges}>
                        {showStockColumn && (
                          <span className={styles.cardStock}>{formatNumber(product.stock)} estoque</span>
                        )}
                        {showStockRedeColumn && product.estoqueRede !== undefined && (
                          <span className={styles.cardStockRede}>{formatNumber(product.estoqueRede)} rede</span>
                        )}
                      </div>
                      <div className={styles.cardPriceInfo}>
                        <span className={styles.cardPriceItem}>
                          <span className={styles.cardPriceLabel}>Preco:</span> {formatCurrency(product.averagePrice)}
                        </span>
                        {podeVerCusto && (
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
