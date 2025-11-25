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

function formatVariance(value: number | null, currentRevenue: number): {
  text: string;
  isPositive: boolean;
  isNegative: boolean;
  isNeutral: boolean;
  explanation: string;
} {
  if (value === null) {
    // null significa que não havia vendas no período anterior, mas há agora
    if (currentRevenue > 0) {
      return {
        text: "Novo",
        isPositive: true,
        isNegative: false,
        isNeutral: false,
        explanation: "Primeira venda no período"
      };
    } else {
      return {
        text: "--",
        isPositive: false,
        isNegative: false,
        isNeutral: true,
        explanation: "Sem vendas"
      };
    }
  }

  if (value === 0) {
    return {
      text: "0%",
      isPositive: false,
      isNegative: false,
      isNeutral: true,
      explanation: "Sem mudança"
    };
  }

  const isPositive = value > 0;
  const isNegative = value < 0;
  
  // Para -100%, mostrar texto mais claro
  if (value === -100) {
    return {
      text: "Parou",
      isPositive: false,
      isNegative: true,
      isNeutral: false,
      explanation: "Não vendeu neste período"
    };
  }

  return {
    text: `${isPositive ? "+" : ""}${value.toFixed(1)}%`,
    isPositive,
    isNegative,
    isNeutral: false,
    explanation: isPositive 
      ? `Aumentou ${Math.abs(value).toFixed(1)}% em relação ao período anterior`
      : `Diminuiu ${Math.abs(value).toFixed(1)}% em relação ao período anterior`
  };
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
              <th className={styles.varianceHeader}>VAR. %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const variance = formatVariance(row.revenueVariance, row.revenue);

              return (
                <tr key={row.filial}>
                  <td className={styles.filialCell}>{row.filialDisplayName}</td>
                  <td className={styles.currencyCell}>{formatCurrency(row.revenue)}</td>
                  <td className={styles.numberCell}>{formatNumber(row.quantity)}</td>
                  <td className={styles.numberCell}>{formatNumber(row.stock)}</td>
                  <td className={styles.varianceCell}>
                    <span
                      className={`${styles.varianceValue} ${
                        variance.isPositive
                          ? styles.variancePositive
                          : variance.isNegative
                            ? styles.varianceNegative
                            : styles.varianceNeutral
                      }`}
                      title={variance.explanation}
                    >
                      {variance.isPositive && "↑"}
                      {variance.isNegative && "↓"}
                      {variance.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {data.map((row) => {
            const variance = formatVariance(row.revenueVariance, row.revenue);

            return (
              <div key={row.filial} className={styles.card}>
                <div className={styles.cardMain}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardFilialContainer}>
                      <h4 className={styles.cardFilial}>{row.filialDisplayName}</h4>
                      <span
                        className={`${styles.cardVariance} ${
                          variance.isPositive
                            ? styles.variancePositive
                            : variance.isNegative
                              ? styles.varianceNegative
                              : styles.varianceNeutral
                        }`}
                        title={variance.explanation}
                      >
                        {variance.isPositive && "↑"}
                        {variance.isNegative && "↓"}
                        {variance.text}
                      </span>
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
            );
          })}
        </div>
      </div>
    </div>
  );
}




