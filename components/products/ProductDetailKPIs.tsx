"use client";

import type { ProductDetailInfo } from "@/lib/repositories/productDetail";

import styles from "./ProductDetailKPIs.module.css";

interface ProductDetailKPIsProps {
  detail: ProductDetailInfo;
  companyName: string;
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

export default function ProductDetailKPIs({
  detail,
  companyName,
}: ProductDetailKPIsProps) {
  const items = [
    {
      label: "Vendas Total",
      value: formatCurrency(detail.totalRevenue),
      description: `${detail.totalQuantity} unidades vendidas`,
      highlight: true,
    },
    {
      label: "Estoque Total",
      value: formatInteger(detail.totalStock),
      description: "Unidades disponíveis",
    },
    {
      label: "Melhor Loja",
      value: detail.topFilialDisplayName || detail.topFilial || "--",
      description: detail.topFilial
        ? `Melhor performance - ${formatCurrency(detail.topFilialRevenue)}`
        : "Nenhuma venda registrada",
    },
    {
      label: "Cor Mais Vendida",
      value: detail.topColorDisplayName || detail.topColor || "--",
      valueExtra: detail.topColorCode || null,
      description:
        detail.topColor && detail.topColorQuantity > 0
          ? `${detail.topColorQuantity} unidades · Markup: ${formatMarkup(detail.topColorMarkup)}`
          : "Nenhuma cor registrada",
    },
  ];

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <article key={item.label} className={styles.card}>
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
              {item.valueExtra && (
                <span className={styles.colorCode}>{item.valueExtra}</span>
              )}
            </div>
            <p className={styles.description}>{item.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

