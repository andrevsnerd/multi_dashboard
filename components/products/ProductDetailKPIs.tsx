"use client";

import type { ReactNode } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ProductDetailInfo,
  ProductSaleHistory,
  ProductStockByFilial,
} from "@/lib/repositories/productDetail";

import styles from "./ProductDetailKPIs.module.css";

interface ProductDetailKPIsProps {
  detail: ProductDetailInfo;
  companyName: string;
  range: {
    startDate: Date;
    endDate: Date;
  };
  saleHistory: ProductSaleHistory[];
  stockByFilial: ProductStockByFilial[];
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

export default function ProductDetailKPIs({
  detail,
  range,
  saleHistory,
  stockByFilial,
}: ProductDetailKPIsProps) {
  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const totalDaysInMonth = lastDayOfMonth.getDate();
  const daysPassed = Math.min(
    Math.ceil((end.getTime() - currentMonth.getTime()) / (1000 * 60 * 60 * 24)),
    totalDaysInMonth
  );

  const stockProjectionEndMonth = (() => {
    if (daysPassed <= 0 || detail.totalQuantity === 0) return detail.totalStock;
    const averageDailyQuantity = detail.totalQuantity / daysPassed;
    const monthlyProjectionQuantity = averageDailyQuantity * totalDaysInMonth;
    return Math.max(0, Math.round(detail.totalStock - monthlyProjectionQuantity));
  })();

  const consumptionProjected = daysPassed > 0 && detail.totalQuantity > 0
    ? Math.round((detail.totalQuantity / daysPassed) * 30)
    : 0;

  const daysUntilStockOut = detail.totalQuantity > 0 && consumptionProjected > 0
    ? Math.floor((detail.totalStock / consumptionProjected) * 30)
    : null;

  const chartData = (() => {
    const monthStart = startOfMonth(start);
    const monthEnd = endOfMonth(start);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const revenueByDay = new Map<string, number>();
    saleHistory.forEach((sale) => {
      const d = sale.date instanceof Date ? sale.date : new Date(sale.date);
      const key = format(d, "yyyy-MM-dd");
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.revenue);
    });
    let cumulative = 0;
    const averageDaily = daysPassed > 0 && detail.totalRevenue > 0
      ? detail.totalRevenue / daysPassed
      : 0;
    return days.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      const dayRevenue = revenueByDay.get(key) ?? 0;
      cumulative += dayRevenue;
      const dayIndex = day.getDate();
      const projection = averageDaily * dayIndex;
      return {
        day: format(day, "dd", { locale: ptBR }),
        vendasReais: Math.round(cumulative * 100) / 100,
        projecao: Math.round(projection * 100) / 100,
      };
    });
  })();

  const quantityVariance = detail.totalQuantity > 0 && detail.revenueVariance !== null
    ? detail.revenueVariance
    : null;

  const topFilialSalesCount = saleHistory
    .filter((s) => (s.filialDisplayName || s.filial) === (detail.topFilialDisplayName || detail.topFilial))
    .length;

  const topFilialStock = detail.topFilial
    ? stockByFilial.find((f) => f.filial === detail.topFilial || f.filialDisplayName === detail.topFilialDisplayName)?.stock ?? 0
    : 0;

  const topColorPct = detail.totalQuantity > 0 && detail.topColorQuantity > 0
    ? Math.round((detail.topColorQuantity / detail.totalQuantity) * 100)
    : 0;

  return (
    <div className={styles.section}>
      {/* Primeira linha: 5 KPIs */}
      <div className={styles.kpiRow}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>VALOR TOTAL DE VENDAS</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </span>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatCurrency(detail.totalRevenue)}</span>
            {detail.revenueVariance !== null && (
              <span
                className={`${styles.variance} ${
                  detail.revenueVariance > 0 ? styles.variancePositive : detail.revenueVariance < 0 ? styles.varianceNegative : ""
                }`}
              >
                {detail.revenueVariance > 0 ? "↑" : detail.revenueVariance < 0 ? "↓" : ""}
                {Math.abs(detail.revenueVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>Receita bruta do período</p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>QUANTIDADE VENDIDA</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            </span>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatInteger(detail.totalQuantity)}</span>
            {quantityVariance !== null && (
              <span
                className={`${styles.variance} ${
                  quantityVariance > 0 ? styles.variancePositive : quantityVariance < 0 ? styles.varianceNegative : ""
                }`}
              >
                {quantityVariance > 0 ? "↑" : quantityVariance < 0 ? "↓" : ""}
                {Math.abs(quantityVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>unidades no período</p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>PREÇO DE VENDA</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </span>
          </header>
          <div className={styles.cardValue}>{formatCurrency(detail.registeredPrice)}</div>
          <p className={styles.cardDescription}>Preço de venda cadastrado</p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>CUSTO UNITÁRIO</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </span>
          </header>
          <div className={styles.cardValue}>{formatCurrency(detail.registeredCost)}</div>
          <p className={styles.cardDescription}>Custo cadastrado</p>
        </article>
      </div>

      {/* Segunda linha: Loja + Cor */}
      <div className={styles.kpiRowTwo}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardIconSvgLeft} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </span>
            <span className={styles.cardLabel}>LOJA QUE MAIS VENDEU</span>
          </header>
          <div className={styles.cardValue}>
            {detail.topFilialDisplayName || detail.topFilial || "--"}
          </div>
          <p className={styles.cardDescription}>
            {detail.topFilial ? (
              <>
                <span className={styles.topFilialRevenue}>{formatCurrency(detail.topFilialRevenue)}</span>
                <span> {topFilialSalesCount} vendas</span>
                <span>
                  {" · "}
                  <span className={topFilialStock <= 0 ? styles.stockLow : ""}>
                    {formatInteger(topFilialStock)} estoque
                  </span>
                </span>
              </>
            ) : (
              "Nenhuma venda registrada"
            )}
          </p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardIconSvgLeft} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </span>
            <span className={styles.cardLabel}>COR MAIS VENDIDA</span>
          </header>
          <div className={styles.cardValue}>
            {detail.topColorDisplayName || detail.topColor || "--"}
          </div>
          <p className={styles.cardDescriptionHighlight}>
            {detail.topColor && detail.topColorQuantity > 0
              ? `${detail.topColorQuantity} unidades · ${topColorPct}% do total`
              : "Nenhuma cor registrada"}
          </p>
        </article>
      </div>

      {/* Performance de Vendas + Projeção de Estoque */}
      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Performance de Vendas</h3>
          <p className={styles.chartSubtitle}>Acompanhamento mensal de vendas vs projeção</p>
          <div className={styles.chartLegend}>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotBlue} /> Vendas Reais
            </span>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotGray} /> Projeção
            </span>
          </div>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="day"
                  stroke="#94a3b8"
                  style={{ fontSize: "12px" }}
                  tick={{ fill: "#64748b" }}
                />
                <YAxis
                  stroke="#94a3b8"
                  style={{ fontSize: "12px" }}
                  tick={{ fill: "#64748b" }}
                  tickFormatter={(v) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "8px 12px",
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                  labelStyle={{ color: "#64748b", fontSize: "12px" }}
                />
                <Line
                  type="monotone"
                  dataKey="vendasReais"
                  name="Vendas Reais"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: "#2563eb", r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="projecao"
                  name="Projeção"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={styles.stockProjectionCard}>
          <h3 className={styles.stockProjectionTitle}>
            <span className={styles.stockProjectionIcon} aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </span>
            Projeção de Estoque
          </h3>
          <div className={styles.stockProjectionGrid}>
            <div className={styles.stockProjectionItem}>
              <span className={styles.stockProjectionLabel}>ESTOQUE ATUAL</span>
              <span className={styles.stockProjectionValue}>{detail.totalStock} unidades</span>
            </div>
            <div className={styles.stockProjectionItem}>
              <span className={styles.stockProjectionLabel}>PROJEÇÃO FIM DO MÊS</span>
              <span className={styles.stockProjectionValue}>{stockProjectionEndMonth} unidades</span>
            </div>
          </div>
          <div className={styles.consumoProjected}>
            <span className={styles.consumoLabel}>Consumo projetado</span>
            <div className={styles.progressBarWrapper}>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressBarFill}
                  style={{
                    width: `${consumptionProjected > 0 && detail.totalStock > 0
                      ? Math.min(100, (consumptionProjected / Math.max(consumptionProjected, detail.totalStock * 2)) * 100)
                      : 0}%`,
                  }}
                />
              </div>
              <span className={styles.consumoValue}>{consumptionProjected} un/mês</span>
            </div>
          </div>
          {daysUntilStockOut != null && daysUntilStockOut > 0 && (
            <p className={styles.depletionEstimate}>
              <span className={styles.depletionIcon} aria-hidden>~</span>
              Estimativa de {daysUntilStockOut} dias até esgotar estoque
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
