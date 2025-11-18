import type { MetricSummary, SalesSummary } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { shiftRangeByMonths } from "@/lib/utils/date";

import styles from "./SummaryCards.module.css";

interface SummaryCardsProps {
  summary: SalesSummary;
  companyName: string;
  periodLabel?: string;
  dateRange?: DateRangeValue;
}

type MetricFormatter = (value: number) => string;

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

function resolveChangeBadge(metric: MetricSummary) {
  if (metric.changePercentage === null) {
    const trend =
      metric.currentValue > metric.previousValue
        ? ("positive" as const)
        : metric.currentValue < metric.previousValue
          ? ("negative" as const)
          : ("neutral" as const);

    const symbol =
      trend === "positive" ? "^" : trend === "negative" ? "v" : null;

    return {
      trend,
      label: symbol ? `${symbol} --` : "--",
    };
  }

  if (metric.changePercentage === 0) {
    return {
      trend: "neutral" as const,
      label: "0,0%",
    };
  }

  const trend = metric.changePercentage > 0 ? "positive" : "negative";
  const symbol = metric.changePercentage > 0 ? "^" : "v";
  const changeLabel = Math.abs(metric.changePercentage).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return {
    trend,
    label: `${symbol} ${changeLabel}%`,
  };
}

export default function SummaryCards({
  summary,
  companyName,
  periodLabel = "Mês atual",
  dateRange,
}: SummaryCardsProps) {
  const trendClassMap: Record<
    ReturnType<typeof resolveChangeBadge>["trend"],
    string
  > = {
    positive: styles.changeBadgePositive,
    negative: styles.changeBadgeNegative,
    neutral: styles.changeBadgeNeutral,
  };

  // Calcular o período anterior e os dias analisados
  const previousPeriodLabel = (() => {
    if (!dateRange) {
      return "MÊS ANTERIOR";
    }

    const currentRange = {
      start: dateRange.startDate,
      end: dateRange.endDate,
    };
    const previousRange = shiftRangeByMonths(currentRange, -1);
    
    const startDay = previousRange.start.getDate();
    // O end pode ser exclusivo (início do próximo dia), então subtrair 1 dia para obter o último dia do período
    const endDate = new Date(previousRange.end);
    endDate.setDate(endDate.getDate() - 1);
    const endDay = endDate.getDate();
    
    return `MÊS ANTERIOR (${startDay}-${endDay})`;
  })();

  const items: Array<{
    label: string;
    metric: MetricSummary;
    description: string;
    format: MetricFormatter;
    highlight?: boolean;
    secondaryValue?: {
      metric: MetricSummary;
      format: MetricFormatter;
      label: string;
    };
  }> = [
    {
      label: "Vendas Total",
      metric: summary.totalRevenue,
      description: `${companyName} · ${periodLabel}`,
      format: formatCurrency,
      highlight: true,
    },
    {
      label: "Produtos Vendidos",
      metric: summary.totalQuantity,
      description: "Quantidade líquida de itens",
      format: formatInteger,
    },
    {
      label: "Ticket Médio",
      metric: summary.averageTicket,
      description: `${formatInteger(summary.totalTickets.currentValue)} tickets`,
      format: formatCurrency,
    },
    {
      label: "Estoque Total",
      metric: summary.totalStockQuantity,
      description: "Quantidade total em estoque",
      format: formatInteger,
      secondaryValue: {
        metric: summary.totalStockValue,
        format: formatCurrency,
        label: "Valor total",
      },
    },
  ];

  return (
    <div className={styles.grid}>
      {items.map((item) => {
        const badge = resolveChangeBadge(item.metric);

        return (
          <article key={item.label} className={styles.card}>
            <header className={styles.cardHeader}>
              <span className={styles.label}>{item.label}</span>
            </header>

            <div className={styles.valueBlock}>
              <strong
                className={`${styles.value} ${
                  item.highlight ? styles.valueHighlight : ""
                }`}
              >
                {item.format(item.metric.currentValue)}
              </strong>
              {item.secondaryValue && (
                <div className={styles.secondaryValue}>
                  <span className={styles.secondaryLabel}>
                    {item.secondaryValue.label}:
                  </span>
                  <strong className={styles.secondaryValueText}>
                    {item.secondaryValue.format(item.secondaryValue.metric.currentValue)}
                  </strong>
                </div>
              )}
            </div>

            {item.metric.changePercentage !== null && (
              <>
                <div className={styles.divider} aria-hidden />
                <div className={styles.comparison}>
                  <div className={styles.previous}>
                    <span className={styles.previousLabel}>{previousPeriodLabel}</span>
                    <strong className={styles.previousValue}>
                      {item.format(item.metric.previousValue)}
                    </strong>
                  </div>
                  <span
                    className={`${styles.changeBadge} ${trendClassMap[badge.trend]}`}
                  >
                    {badge.label}
                  </span>
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
