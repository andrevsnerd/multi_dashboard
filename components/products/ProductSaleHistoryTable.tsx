"use client";

import type { ProductSaleHistory } from "@/lib/repositories/productDetail";

import styles from "./ProductSaleHistoryTable.module.css";

interface ProductSaleHistoryTableProps {
  data: ProductSaleHistory[];
  loading?: boolean;
  totalRevenue: number;
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

function formatDate(date: Date | string): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleDateString("pt-BR");
}

export default function ProductSaleHistoryTable({
  data,
  loading,
  totalRevenue,
}: ProductSaleHistoryTableProps) {
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
        <div className={styles.empty}>Nenhuma venda encontrada no período</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>Histórico de Vendas</h3>
      <div className={styles.container}>
        {/* Desktop: Tabela tradicional */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.dateHeader}>DATA</th>
              <th className={styles.filialHeader}>FILIAL</th>
              <th className={styles.numberHeader}>QUANTIDADE</th>
              <th className={styles.currencyHeader}>VALOR</th>
              <th className={styles.colorHeader}>COR</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => {
              const dateObj = row.date instanceof Date ? row.date : new Date(row.date);
              return (
              <tr key={`${dateObj.getTime()}-${row.filial}-${index}`}>
                <td className={styles.dateCell}>{formatDate(dateObj)}</td>
                <td className={styles.filialCell}>{row.filialDisplayName}</td>
                <td className={styles.numberCell}>{formatNumber(row.quantity)}</td>
                <td className={styles.currencyCell}>{formatCurrency(row.revenue)}</td>
                <td className={styles.colorCell}>{row.colorDisplayName || "--"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {data.map((row, index) => {
            const dateObj = row.date instanceof Date ? row.date : new Date(row.date);
            return (
              <div key={`${dateObj.getTime()}-${row.filial}-${index}`} className={styles.card}>
                <div className={styles.cardMain}>
                  <div className={styles.cardLeft}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardDate}>{formatDate(dateObj)}</span>
                      {row.colorDisplayName && (
                        <span className={styles.cardColor}>{row.colorDisplayName}</span>
                      )}
                    </div>
                    <div className={styles.cardRevenue}>
                      <span className={styles.cardRevenueValue}>{formatCurrency(row.revenue)}</span>
                      <span className={styles.cardQuantity}>{formatNumber(row.quantity)} unidades</span>
                    </div>
                  </div>
                  <div className={styles.cardRight}>
                    <span className={styles.cardFilial}>{row.filialDisplayName}</span>
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

