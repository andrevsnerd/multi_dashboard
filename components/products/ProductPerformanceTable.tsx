"use client";

import type { ProductStockByFilial } from "@/lib/repositories/productDetail";

import styles from "./ProductPerformanceTable.module.css";

interface ProductPerformanceTableProps {
  data: ProductStockByFilial[];
  loading?: boolean;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPercentage(value: number | null): string | null {
  if (value === null) return null;
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default function ProductPerformanceTable({
  data,
  loading,
}: ProductPerformanceTableProps) {
  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhuma filial encontrada</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>Vendas e estoque em cada filial</h3>
      <div className={styles.container}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.filialHeader}>FILIAL</th>
              <th className={styles.currencyHeader}>FATURAMENTO</th>
              <th className={styles.numberHeader}>QTD</th>
              <th className={styles.numberHeader}>ESTOQUE</th>
              <th className={styles.varianceHeader}>VAR. %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const variance = formatPercentage(row.revenueVariance);
              const isPositive = row.revenueVariance !== null && row.revenueVariance > 0;
              const isNegative = row.revenueVariance !== null && row.revenueVariance < 0;

              return (
                <tr key={row.filial}>
                  <td className={styles.filialCell}>{row.filialDisplayName}</td>
                  <td className={styles.currencyCell}>{formatCurrency(row.revenue)}</td>
                  <td className={styles.numberCell}>{formatNumber(row.quantity)}</td>
                  <td className={styles.numberCell}>{formatNumber(row.stock)}</td>
                  <td className={styles.varianceCell}>
                    {variance ? (
                      <span
                        className={`${styles.varianceValue} ${
                          isPositive
                            ? styles.variancePositive
                            : isNegative
                              ? styles.varianceNegative
                              : ""
                        }`}
                      >
                        {isPositive && "↑"}
                        {isNegative && "↓"}
                        {variance}
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}



