import type { SalesSummary } from "@/types/dashboard";

import styles from "./SummaryCards.module.css";

interface SummaryCardsProps {
  summary: SalesSummary;
  companyName: string;
  periodLabel?: string;
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

export default function SummaryCards({
  summary,
  companyName,
  periodLabel = "Mês atual",
}: SummaryCardsProps) {
  const items = [
    {
      label: "Faturamento Total",
      value: formatCurrency(summary.totalRevenue),
      description: `${companyName} · ${periodLabel}`,
      highlight: true,
    },
    {
      label: "Produtos Vendidos",
      value: formatInteger(summary.totalQuantity),
      description: "Quantidade líquida de itens",
    },
    {
      label: "Ticket Médio",
      value: formatCurrency(summary.averageTicket),
      description: `${formatInteger(summary.totalTickets)} tickets`,
    },
  ];

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <article key={item.label} className={styles.card}>
          <span className={styles.label}>{item.label}</span>
          <strong
            className={`${styles.value} ${item.highlight ? styles.highlight : ""}`}
          >
            {item.value}
          </strong>
          <span className={styles.description}>{item.description}</span>
        </article>
      ))}
    </div>
  );
}


