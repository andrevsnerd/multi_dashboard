"use client";

import type { ReactNode } from "react";
import type { ProductDetailInfo } from "@/lib/repositories/productDetail";

import styles from "./ProductDetailKPIs.module.css";

interface ProductDetailKPIsProps {
  detail: ProductDetailInfo;
  companyName: string;
  range: {
    startDate: Date;
    endDate: Date;
  };
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

function formatMarkup(value: number): string {
  return `${value.toFixed(2)}x`;
}

interface KPIItem {
  label: string;
  value: string;
  description: string;
  highlight?: boolean;
  markup?: string | null;
  valueExtra?: ReactNode | null;
  colorCode?: string | null;
}

export default function ProductDetailKPIs({
  detail,
  companyName,
  range,
}: ProductDetailKPIsProps) {
  // Calcular projeção de estoque no fim do mês
  const calculateStockProjection = (): number => {
    const start = new Date(range.startDate);
    const end = new Date(range.endDate);
    const daysInPeriod = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    );
    
    // Obter o mês atual
    const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const totalDaysInMonth = lastDayOfMonth.getDate();
    
    // Calcular dias já passados no mês (até o endDate)
    const daysPassed = Math.min(
      Math.ceil((end.getTime() - currentMonth.getTime()) / (1000 * 60 * 60 * 24)),
      totalDaysInMonth
    );
    
    if (daysPassed <= 0 || detail.totalQuantity === 0) {
      return detail.totalStock;
    }
    
    // Calcular média diária de vendas e projeção do mês
    const averageDailyQuantity = detail.totalQuantity / daysPassed;
    const monthlyProjectionQuantity = averageDailyQuantity * totalDaysInMonth;
    
    // Projeção de estoque = estoque atual - projeção de vendas do mês
    const stockProjection = detail.totalStock - monthlyProjectionQuantity;
    
    return Math.max(0, stockProjection);
  };

  const stockProjection = calculateStockProjection();

  const items: KPIItem[] = [
    {
      label: "Vendas Total",
      value: formatCurrency(detail.totalRevenue),
      description: `${detail.totalQuantity} unidades`,
      highlight: true,
      valueExtra: detail.revenueVariance !== null ? (
        <span
          className={`${styles.variance} ${
            detail.revenueVariance > 0
              ? styles.variancePositive
              : detail.revenueVariance < 0
                ? styles.varianceNegative
                : ""
          }`}
        >
          {detail.revenueVariance > 0 ? "↑" : detail.revenueVariance < 0 ? "↓" : ""}
          {Math.abs(detail.revenueVariance).toFixed(1)}%
        </span>
      ) : null,
    },
    {
      label: "Preço Médio",
      value: formatCurrency(detail.averagePrice),
      description: `Custo: ${formatCurrency(detail.averageCost)}`,
    },
    {
      label: "Estoque Total",
      value: formatInteger(detail.totalStock),
      description: `Projeção do Mês: ${formatInteger(stockProjection)} unidades`,
    },
    {
      label: "Melhor Loja",
      value: detail.topFilialDisplayName || detail.topFilial || "--",
      description: detail.topFilial
        ? formatCurrency(detail.topFilialRevenue)
        : "Nenhuma venda registrada",
    },
    {
      label: "Cor Mais Vendida",
      value: detail.topColorDisplayName || detail.topColor || "--",
      valueExtra: null,
      description:
        detail.topColor && detail.topColorQuantity > 0
          ? `${detail.topColorQuantity} unidades`
          : "Nenhuma cor registrada",
      colorCode: null,
    },
  ];

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <article 
          key={item.label} 
          className={`${styles.card} ${item.label === "Vendas Total" ? styles.vendasTotalCard : ""}`}
        >
          <header className={styles.cardHeader}>
            <span className={styles.label}>{item.label}</span>
          </header>

          <div className={styles.valueBlock}>
            <div className={styles.valueContainer}>
              <strong
                className={`${styles.value} ${item.highlight ? styles.valueHighlight : ""}`}
              >
                {item.value}
              </strong>
              {item.valueExtra}
            </div>
            <p className={styles.description}>
              {item.description}
              {item.colorCode && (
                <span className={styles.colorCodeInline}> · {item.colorCode}</span>
              )}
              {item.markup && (
                <span className={styles.markup}> · Markup: {item.markup}</span>
              )}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

