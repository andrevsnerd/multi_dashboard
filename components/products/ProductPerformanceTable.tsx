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
      <h3 className={styles.title}>Performance por Filial</h3>
      <div className={styles.container}>
        {/* Desktop: Tabela tradicional */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.filialHeader}>FILIAL</th>
              <th className={styles.currencyHeader}>FATURAMENTO</th>
              <th className={styles.numberHeader}>QTD</th>
              <th className={styles.numberHeader}>ESTOQUE</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.filial}>
                <td className={styles.filialCell}>{row.filialDisplayName}</td>
                <td className={styles.currencyCell}>{formatCurrency(row.revenue)}</td>
                <td className={styles.numberCell}>{formatNumber(row.quantity)}</td>
                <td className={styles.numberCell}>{formatNumber(row.stock)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td className={styles.filialCell}>TOTAL</td>
              <td className={styles.currencyCell}>
                {formatCurrency(data.reduce((sum, row) => sum + row.revenue, 0))}
              </td>
              <td className={styles.numberCell}>
                {formatNumber(data.reduce((sum, row) => sum + row.quantity, 0))}
              </td>
              <td className={styles.numberCell}>
                {formatNumber(data.reduce((sum, row) => sum + row.stock, 0))}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {data.map((row) => (
            <div key={row.filial} className={styles.card}>
              <div className={styles.cardMain}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardFilialContainer}>
                    <h4 className={styles.cardFilial}>{row.filialDisplayName}</h4>
                  </div>
                  <span className={styles.cardStock}>
                    {formatNumber(row.stock)} estoque
                  </span>
                </div>
                <div className={styles.cardRevenue}>
                  <span className={styles.cardRevenueValue}>{formatCurrency(row.revenue)}</span>
                  <span className={styles.cardQuantity}>{formatNumber(row.quantity)} unidades</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}




