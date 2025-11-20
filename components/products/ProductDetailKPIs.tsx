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

interface KPIItem {
  label: string;
  value: string;
  description: string;
  highlight?: boolean;
  markup?: string | null;
  valueExtra?: string | null;
  colorCode?: string | null;
}

export default function ProductDetailKPIs({
  detail,
  companyName,
}: ProductDetailKPIsProps) {
  const items: KPIItem[] = [
    {
      label: "Vendas Total",
      value: formatCurrency(detail.totalRevenue),
      description: `${detail.totalQuantity} unidades`,
      markup: detail.totalMarkup && detail.totalMarkup > 0 ? formatMarkup(detail.totalMarkup) : null,
      highlight: true,
    },
    {
      label: "Preço Médio",
      value: formatCurrency(detail.averagePrice),
      description: `Custo: ${formatCurrency(detail.averageCost)}`,
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
        ? formatCurrency(detail.topFilialRevenue)
        : "Nenhuma venda registrada",
    },
    {
      label: "Cor Mais Vendida",
      value: detail.topColorDisplayName || detail.topColor || "--",
      valueExtra: null,
      description:
        detail.topColor && detail.topColorQuantity > 0
          ? detail.topColorCode
            ? `${detail.topColorCode} · ${detail.topColorQuantity} unidades`
            : `${detail.topColorQuantity} unidades`
          : "Nenhuma cor registrada",
      colorCode: null,
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

