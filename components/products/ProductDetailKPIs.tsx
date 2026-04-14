"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Bar,
} from "recharts";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  subMonths,
  startOfDay,
  differenceInCalendarDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ProductDetailInfo,
  ProductSaleHistory,
  ProductStockByFilial,
  ProductPrecoItem,
  ProductCustoItem,
  ProductStockProgressDay,
} from "@/lib/repositories/productDetail";
import { resolveCompany } from "@/lib/config/company";

import styles from "./ProductDetailKPIs.module.css";

export interface ProductDetailKPIsProps {
  detail: ProductDetailInfo;
  productId: string;
  companyKey: string;
  companyName: string;
  range: {
    startDate: Date;
    endDate: Date;
  };
  saleHistory: ProductSaleHistory[];
  /** Vendas nos meses anteriores ao range (para cada dia: acumulado até o mesmo dia do mês civil anterior). */
  saleHistoryComparison?: ProductSaleHistory[];
  stockByFilial: ProductStockByFilial[];
  stockProgress: ProductStockProgressDay[];
  onDetailUpdated?: () => void;
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
  productId,
  companyKey,
  range,
  saleHistory,
  saleHistoryComparison = [],
  stockByFilial,
  stockProgress = [],
  onDetailUpdated,
}: ProductDetailKPIsProps) {
  const { user } = useAuth();
  const canSeeCusto = user?.role === "admin" || user?.role === "logistica";
  const [modalPrecoOpen, setModalPrecoOpen] = useState(false);
  const [modalCustoOpen, setModalCustoOpen] = useState(false);
  const [precos, setPrecos] = useState<ProductPrecoItem[]>([]);
  const [custos, setCustos] = useState<ProductCustoItem[]>([]);
  const [editedPrecos, setEditedPrecos] = useState<Record<string, string>>({});
  const [editedCustos, setEditedCustos] = useState<Record<string, string>>({});
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [confirmPayload, setConfirmPayload] = useState<{
    type: 'preco' | 'custo';
    codTabela: string;
    origem: 'PRODUTOS' | 'PRODUTOS_PRECOS';
    campo: string;
    valorAnterior: number;
    novoValor: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const openPrecoModal = useCallback(() => {
    setModalError(null);
    setEditedPrecos({});
    setConfirmPayload(null);
    setModalPrecoOpen(true);
    setModalLoading(true);
    fetch(`/api/product-detail/precos?productId=${encodeURIComponent(productId)}&company=${encodeURIComponent(companyKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setPrecos(json.data ?? []);
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao carregar preços'))
      .finally(() => setModalLoading(false));
  }, [productId, companyKey]);

  const openCustoModal = useCallback(() => {
    setModalError(null);
    setEditedCustos({});
    setConfirmPayload(null);
    setModalCustoOpen(true);
    setModalLoading(true);
    fetch(`/api/product-detail/custos?productId=${encodeURIComponent(productId)}&company=${encodeURIComponent(companyKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setCustos(json.data ?? []);
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao carregar custos'))
      .finally(() => setModalLoading(false));
  }, [productId, companyKey]);

  const hasPrecoChange = precos.some((p) => {
    const key = `${p.codTabela}-${p.campo}`;
    const edited = editedPrecos[key];
    if (edited === undefined) return false;
    const raw = edited.replace(',', '.');
    const num = parseFloat(raw);
    return !Number.isNaN(num) && Math.abs(num - p.valor) > 1e-6;
  });
  const hasCustoChange = custos.some((c) => {
    const key = `${c.codTabela}-${c.campo}`;
    const edited = editedCustos[key];
    if (edited === undefined) return false;
    const raw = edited.replace(',', '.');
    const num = parseFloat(raw);
    return !Number.isNaN(num) && Math.abs(num - c.valor) > 1e-6;
  });

  const handleSavePreco = useCallback(() => {
    setModalError(null);
    const item = precos.find((p) => {
      const key = `${p.codTabela}-${p.campo}`;
      const edited = editedPrecos[key];
      if (edited === undefined) return false;
      const raw = edited.replace(',', '.');
      const num = parseFloat(raw);
      return !Number.isNaN(num) && Math.abs(num - p.valor) > 1e-6;
    });
    if (!item) return;
    const key = `${item.codTabela}-${item.campo}`;
    const raw = editedPrecos[key]?.replace(',', '.') ?? '';
    const novoValor = parseFloat(raw);
    if (Number.isNaN(novoValor) || novoValor < 0) {
      setModalError('Valor inválido.');
      return;
    }
    setConfirmPayload({
      type: 'preco',
      codTabela: item.codTabela,
      origem: item.origem,
      campo: item.campo,
      valorAnterior: item.valor,
      novoValor,
    });
  }, [editedPrecos, precos]);

  const handleSaveCusto = useCallback(() => {
    setModalError(null);
    const item = custos.find((c) => {
      const key = `${c.codTabela}-${c.campo}`;
      const edited = editedCustos[key];
      if (edited === undefined) return false;
      const raw = edited.replace(',', '.');
      const num = parseFloat(raw);
      return !Number.isNaN(num) && Math.abs(num - c.valor) > 1e-6;
    });
    if (!item) return;
    const key = `${item.codTabela}-${item.campo}`;
    const raw = editedCustos[key]?.replace(',', '.') ?? '';
    const novoValor = parseFloat(raw);
    if (Number.isNaN(novoValor) || novoValor < 0) {
      setModalError('Valor inválido.');
      return;
    }
    setConfirmPayload({
      type: 'custo',
      codTabela: item.codTabela,
      origem: item.origem,
      campo: item.campo,
      valorAnterior: item.valor,
      novoValor,
    });
  }, [editedCustos, custos]);

  const executeUpdate = useCallback(() => {
    if (!confirmPayload) return;
    setSaving(true);
    setModalError(null);
    fetch('/api/product-detail/update-price-or-cost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        company: companyKey,
        codTabela: confirmPayload.codTabela,
        origem: confirmPayload.origem,
        campo: confirmPayload.campo,
        novoValor: confirmPayload.novoValor,
      }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setConfirmPayload(null);
        setModalPrecoOpen(false);
        setModalCustoOpen(false);
        setEditedPrecos({});
        setEditedCustos({});
        onDetailUpdated?.();
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao salvar'))
      .finally(() => setSaving(false));
  }, [confirmPayload, productId, companyKey, onDetailUpdated]);

  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  const startD = startOfDay(start);
  const endD = startOfDay(end);
  const isMultiMonthRange = !isSameMonth(startD, endD);
  const rangeDayCount = Math.max(1, differenceInCalendarDays(endD, startD) + 1);

  const currentMonthForProjection = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const totalDaysInMonth = lastDayOfMonth.getDate();

  const daysPassed = isMultiMonthRange
    ? rangeDayCount
    : Math.min(
        differenceInCalendarDays(endD, startOfDay(currentMonthForProjection)) + 1,
        totalDaysInMonth,
      );

  const monthlyProjection = (() => {
    if (daysPassed <= 0 || detail.totalRevenue === 0) return 0;
    const averageDaily = detail.totalRevenue / daysPassed;
    return averageDaily * (isMultiMonthRange ? rangeDayCount : totalDaysInMonth);
  })();

  const chartMonthStart = startOfMonth(start);
  const isChartMonthCurrent =
    !isMultiMonthRange && isSameMonth(chartMonthStart, new Date());

  const chartMonthBoundaryIsos = (() => {
    const days = eachDayOfInterval({ start: startD, end: endD });
    return days
      .filter((d, idx) => idx > 0 && d.getDate() === 1)
      .map((d) => format(d, "yyyy-MM-dd"));
  })();

  const chartTickIsos = (() => {
    const days = eachDayOfInterval({ start: startD, end: endD });
    const picked = days.filter(
      (d, i) => i === 0 || d.getDate() === 1 || i === days.length - 1,
    );
    return picked.map((d) => format(d, "yyyy-MM-dd"));
  })();

  const comparisonLegendLabel = "Mês anterior";

  const chartData = (() => {
    const days = eachDayOfInterval({ start: startD, end: endD });
    const revenueByDay = new Map<string, number>();
    const salesByDay = new Map<
      string,
      { filial: string; filialDisplayName: string; quantity: number; revenue: number }[]
    >();

    saleHistory.forEach((sale) => {
      const d = sale.date instanceof Date ? sale.date : new Date(sale.date);
      const key = format(startOfDay(d), "yyyy-MM-dd");
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.revenue);

      if (!salesByDay.has(key)) {
        salesByDay.set(key, []);
      }
      const existing = salesByDay.get(key)!;
      const existingFilial = existing.find((s) => s.filial === sale.filial);
      if (existingFilial) {
        existingFilial.quantity += sale.quantity;
        existingFilial.revenue += sale.revenue;
      } else {
        existing.push({
          filial: sale.filial,
          filialDisplayName: sale.filialDisplayName,
          quantity: sale.quantity,
          revenue: sale.revenue,
        });
      }
    });

    const comparisonRevByIso = new Map<string, number>();
    const comparisonQtyByIso = new Map<string, number>();
    const comparisonSalesByDay = new Map<
      string,
      { filial: string; filialDisplayName: string; quantity: number; revenue: number }[]
    >();
    saleHistoryComparison.forEach((sale) => {
      const d = sale.date instanceof Date ? sale.date : new Date(sale.date);
      const key = format(startOfDay(d), "yyyy-MM-dd");
      comparisonRevByIso.set(key, (comparisonRevByIso.get(key) ?? 0) + sale.revenue);
      comparisonQtyByIso.set(key, (comparisonQtyByIso.get(key) ?? 0) + sale.quantity);
      if (!comparisonSalesByDay.has(key)) {
        comparisonSalesByDay.set(key, []);
      }
      const cRow = comparisonSalesByDay.get(key)!;
      const cFilial = cRow.find((s) => s.filial === sale.filial);
      if (cFilial) {
        cFilial.quantity += sale.quantity;
        cFilial.revenue += sale.revenue;
      } else {
        cRow.push({
          filial: sale.filial,
          filialDisplayName: sale.filialDisplayName,
          quantity: sale.quantity,
          revenue: sale.revenue,
        });
      }
    });

    let cumulativeRange = 0;
    let cumulativePeriodQuantity = 0;
    let comparisonCumulativeRev = 0;
    let comparisonCumulativeQty = 0;

    return days.map((day) => {
      const isoDay = format(day, "yyyy-MM-dd");
      const dayRevenue = revenueByDay.get(isoDay) ?? 0;
      const dayQty =
        salesByDay.get(isoDay)?.reduce((sum, s) => sum + s.quantity, 0) ?? 0;
      cumulativeRange += dayRevenue;
      cumulativePeriodQuantity += dayQty;

      const equivPrevDay = startOfDay(subMonths(day, 1));
      const cmpIso = format(equivPrevDay, "yyyy-MM-dd");
      comparisonCumulativeRev += comparisonRevByIso.get(cmpIso) ?? 0;
      comparisonCumulativeQty += comparisonQtyByIso.get(cmpIso) ?? 0;

      const projection = Math.round(comparisonCumulativeRev * 100) / 100;
      const quantityProjection = Math.round(comparisonCumulativeQty);

      const comparisonDayRevenue = comparisonRevByIso.get(cmpIso) ?? 0;
      const comparisonDayQuantity = Math.round(comparisonQtyByIso.get(cmpIso) ?? 0);

      const daySales = salesByDay.get(isoDay) ?? [];
      const comparisonDayFilials = comparisonSalesByDay.get(cmpIso) ?? [];
      return {
        isoDay,
        day: format(day, "dd/MM", { locale: ptBR }),
        dateLong: format(day, "dd 'de' MMMM yyyy", { locale: ptBR }),
        comparisonDayRevenue: Math.round(comparisonDayRevenue * 100) / 100,
        comparisonDayQuantity,
        comparisonSalesByFilial: comparisonDayFilials,
        vendasReais: Math.round(cumulativeRange * 100) / 100,
        cumulativePeriodQuantity: Math.round(cumulativePeriodQuantity),
        projecao: projection,
        quantityProjection,
        hasSales: daySales.length > 0,
        salesByFilial: daySales,
      };
    });
  })();

  const quantityVariance = detail.totalQuantity > 0 && detail.revenueVariance !== null
    ? detail.revenueVariance
    : null;

  const filialOrder = resolveCompany(companyKey)?.estoqueFilialOrder ?? [];
  const filialOrderMap = new Map(
    filialOrder.map((name, i) => [name.toUpperCase().trim(), i])
  );

  const sortedFiliaisByOrder = useCallback(
    <T extends { filial?: string; filialDisplayName?: string }>(items: T[]) => {
      return [...items].sort((a, b) => {
        const nameA = (a.filialDisplayName || a.filial || "").toUpperCase().trim();
        const nameB = (b.filialDisplayName || b.filial || "").toUpperCase().trim();
        const isMatrizA = nameA === "MATRIZ";
        const isMatrizB = nameB === "MATRIZ";
        if (isMatrizA !== isMatrizB) return isMatrizA ? 1 : -1;
        const idxA = filialOrderMap.get(nameA) ?? filialOrder.length;
        const idxB = filialOrderMap.get(nameB) ?? filialOrder.length;
        return idxA - idxB;
      });
    },
    [filialOrder, filialOrderMap]
  );

  const stockProgressChart = stockProgress.map((row) => {
    const d = new Date(`${row.dateIso}T12:00:00`);
    return {
      isoDay: row.dateIso,
      day: format(d, "dd/MM", { locale: ptBR }),
      dateLong: format(d, "dd 'de' MMMM yyyy", { locale: ptBR }),
      entries: row.entries,
      salesFlow: row.sales > 0 ? row.sales : 0,
      stockExitFlow: row.stockExits > 0 ? row.stockExits : 0,
      stockGeral: row.stockGeral,
      outOfStock: row.outOfStock,
      _raw: row,
    };
  });

  const salesByColorInfo = (() => {
    const codes = new Set(
      saleHistory
        .map((s) => (s.color ?? "").trim())
        .filter(Boolean)
    );
    const hasSpecificColorSelected = codes.size === 1;

    const byColor = new Map<string, { label: string; quantity: number }>();
    saleHistory.forEach((sale) => {
      const label = (sale.colorDisplayName || sale.color || "Sem cor").trim() || "Sem cor";
      const current = byColor.get(label);
      if (current) current.quantity += sale.quantity ?? 0;
      else byColor.set(label, { label, quantity: sale.quantity ?? 0 });
    });

    const rows = Array.from(byColor.values())
      .filter((r) => r.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
    const total = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
    const max = Math.max(1, ...rows.map((r) => r.quantity ?? 0));

    return { hasSpecificColorSelected, rows, total, max };
  })();

  return (
    <div className={styles.section}>
      {/* Primeira linha: 5 KPIs */}
      <div className={`${styles.kpiRow} ${canSeeCusto ? "" : styles.kpiRow3}`}>
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
                {detail.revenueVariance > 0 ? "+" : detail.revenueVariance < 0 ? "-" : ""}
                {Math.abs(detail.revenueVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>
            {isMultiMonthRange ? (
              <>
                Média diária no período:{" "}
                {formatCurrency(detail.totalRevenue / rangeDayCount)} · {rangeDayCount} dias
              </>
            ) : (
              <>
                {isChartMonthCurrent ? "Projeção mês" : "Projeção no mês (média do período)"}:{" "}
                {formatCurrency(monthlyProjection)}
              </>
            )}
          </p>
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
                {quantityVariance > 0 ? "+" : quantityVariance < 0 ? "-" : ""}
                {Math.abs(quantityVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>Unidades no período</p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>PREÇO DE VENDA</span>
            <button
              type="button"
              className={styles.cardEditButton}
              onClick={openPrecoModal}
              aria-label="Editar preços de venda"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatCurrency(detail.registeredPrice)}</span>
          </div>
          <p className={styles.cardDescription}>Preço de venda cadastrado</p>
        </article>

        {canSeeCusto && (
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <span className={styles.cardLabel}>CUSTO UNITÁRIO</span>
              <button
                type="button"
                className={styles.cardEditButton}
                onClick={openCustoModal}
                aria-label="Editar custos unitários"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </header>
            <div className={styles.valueRow}>
              <span className={styles.cardValue}>{formatCurrency(detail.registeredCost)}</span>
            </div>
            <p className={styles.cardDescription}>Custo cadastrado</p>
          </article>
        )}
      </div>

      <div className={styles.filialCardsRow}>
        {/* Estoque por Filial - ordem fixa por empresa */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const sorted = sortedFiliaisByOrder(stockByFilial);
            const total = sorted.reduce((sum, f) => sum + (f.stock ?? 0), 0);
            const max = Math.max(1, ...sorted.map((f) => f.stock ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Estoque por Filial</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {sorted.length} filiais · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {sorted.map((filial) => {
                    const value = filial.stock ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={filial.filial} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>
                          {(filial.filialDisplayName || filial.filial || "").toUpperCase()}
                        </div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.stockByFilialBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Vendas por Filial (quantidade) */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const byFilial = new Map<
              string,
              { filial: string; filialDisplayName: string; quantity: number }
            >();

            saleHistory.forEach((sale) => {
              const key = (sale.filialDisplayName || sale.filial || "").toUpperCase().trim();
              if (!key) return;
              const current = byFilial.get(key);
              if (current) {
                current.quantity += sale.quantity ?? 0;
              } else {
                byFilial.set(key, {
                  filial: sale.filial,
                  filialDisplayName: sale.filialDisplayName || sale.filial,
                  quantity: sale.quantity ?? 0,
                });
              }
            });

            const rows = sortedFiliaisByOrder(Array.from(byFilial.values()));
            const total = rows.reduce((sum, f) => sum + (f.quantity ?? 0), 0);
            const max = Math.max(1, ...rows.map((f) => f.quantity ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Vendas por Filial</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {rows.length} filiais · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {rows.map((filial) => {
                    const value = filial.quantity ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={filial.filialDisplayName} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>
                          {(filial.filialDisplayName || filial.filial || "").toUpperCase()}
                        </div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.salesByFilialBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Performance por Vendedor (quantidade) */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const byVendor = new Map<string, { vendor: string; quantity: number }>();
            saleHistory.forEach((sale) => {
              const vendor = (sale as { vendedor?: string | null }).vendedor ?? null;
              // E-commerce não tem vendedor: ignorar essas vendas aqui
              if (!vendor || !vendor.trim()) return;
              const key = vendor.toUpperCase().trim();
              const current = byVendor.get(key);
              if (current) current.quantity += sale.quantity ?? 0;
              else byVendor.set(key, { vendor: vendor.trim(), quantity: sale.quantity ?? 0 });
            });

            const rows = Array.from(byVendor.values())
              .filter((r) => r.quantity > 0)
              .sort((a, b) => b.quantity - a.quantity);

            const total = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
            const max = Math.max(1, ...rows.map((r) => r.quantity ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Performance por Vendedor</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {rows.length} vendedor(es) · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {rows.map((row) => {
                    const value = row.quantity ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={row.vendor} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>{row.vendor.toUpperCase()}</div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.vendorPerformanceBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Vendas por Cor (quantidade) */}
        {!salesByColorInfo.hasSpecificColorSelected && (
          <section className={styles.stockByFilialCard}>
            <div className={styles.stockByFilialHeader}>
              <h3 className={styles.stockByFilialTitle}>Vendas por Cor</h3>
              <p className={styles.stockByFilialSubtitle}>
                {salesByColorInfo.rows.length} cor(es) · {formatInteger(salesByColorInfo.total)} unidades
              </p>
            </div>

            <div className={styles.stockByFilialList}>
              {salesByColorInfo.rows.map((row) => {
                const value = row.quantity ?? 0;
                const pct = salesByColorInfo.total > 0 ? (value / salesByColorInfo.total) * 100 : 0;
                const bar = (value / salesByColorInfo.max) * 100;
                return (
                  <div key={row.label} className={styles.stockByFilialRow}>
                    <div className={styles.stockByFilialName}>{row.label.toUpperCase()}</div>
                    <div className={styles.stockByFilialBarWrap} aria-hidden>
                      <div className={styles.salesByColorBar} style={{ width: `${bar}%` }} />
                    </div>
                    <div className={styles.stockByFilialNumbers}>
                      <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                      <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Performance de Vendas */}
      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Performance de Vendas</h3>
          <p className={styles.chartSubtitle}>
            {isMultiMonthRange
              ? "Azul · acumulado no filtro · Cinza · mesmo dia no mês passado · Traço · troca de mês"
              : "Azul · acumulado no período · Cinza · referência (mesmo dia, mês passado)"}
          </p>
          <div className={styles.chartLegend}>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotBlue} /> Vendas no período
            </span>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotGray} /> {comparisonLegendLabel}
            </span>
          </div>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                {chartMonthBoundaryIsos.map((iso) => (
                  <ReferenceLine
                    key={iso}
                    x={iso}
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                ))}
                <XAxis
                  dataKey="isoDay"
                  type="category"
                  ticks={chartTickIsos}
                  stroke="#94a3b8"
                  style={{ fontSize: "11px" }}
                  tick={{ fill: "#64748b" }}
                  tickFormatter={(iso) =>
                    format(new Date(`${iso}T12:00:00`), isMultiMonthRange ? "dd/MM" : "dd", {
                      locale: ptBR,
                    })
                  }
                />
                <YAxis
                  stroke="#94a3b8"
                  style={{ fontSize: "12px" }}
                  tick={{ fill: "#64748b" }}
                  tickFormatter={(v) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
                />
                <Tooltip
                  wrapperStyle={{ outline: "none" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const data = payload[0]?.payload;
                    const unitsThisDay =
                      data.salesByFilial?.reduce(
                        (sum: number, s: { quantity: number }) => sum + s.quantity,
                        0,
                      ) ?? 0;
                    const revenueThisDay =
                      data.salesByFilial?.reduce(
                        (sum: number, s: { revenue: number }) => sum + s.revenue,
                        0,
                      ) ?? 0;
                    return (
                      <div
                        style={{
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          fontSize: "12px",
                          minWidth: 440,
                          maxWidth: 620,
                          width: "max-content",
                        }}
                      >
                        <p style={{ margin: "0 0 10px 0", fontWeight: 600, color: "#64748b", fontSize: "11px" }}>
                          {data.dateLong}
                        </p>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: "10px",
                            alignItems: "stretch",
                            marginBottom: "10px",
                          }}
                        >
                        <div
                          style={{
                            flex: "1 1 220px",
                            minWidth: 220,
                            background: "linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)",
                            borderLeft: "3px solid #2563eb",
                            borderRadius: "8px",
                            padding: "10px 10px 8px 12px",
                          }}
                        >
                          <p style={{ margin: "0 0 6px 0", fontSize: "10px", fontWeight: 700, color: "#1d4ed8", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                            Período atual
                          </p>
                          <p style={{ margin: "0 0 4px 0", fontSize: "11px", fontWeight: 600, color: "#1e3a8a" }}>
                            Neste dia
                          </p>
                          {data.hasSales && unitsThisDay > 0 ? (
                            <>
                              <p style={{ margin: "0 0 2px 0", fontSize: "18px", fontWeight: 700, color: "#2563eb" }}>
                                {formatCurrency(revenueThisDay)}
                              </p>
                              <p style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 600, color: "#1d4ed8" }}>
                                {unitsThisDay} {unitsThisDay === 1 ? "unidade" : "unidades"}
                              </p>
                            </>
                          ) : (
                            <p style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600, color: "#93c5fd" }}>
                              Sem venda
                            </p>
                          )}
                          {data.hasSales && data.salesByFilial && data.salesByFilial.length > 0 ? (
                            <div style={{ paddingTop: "6px", borderTop: "1px solid rgba(37, 99, 235, 0.2)" }}>
                              <p style={{ margin: "0 0 4px 0", fontSize: "10px", fontWeight: 700, color: "#1e40af" }}>
                                Onde vendeu
                              </p>
                              {data.salesByFilial.map(
                                (
                                  s: {
                                    filialDisplayName: string;
                                    quantity: number;
                                    revenue: number;
                                  },
                                  idx: number,
                                ) => (
                                  <div
                                    key={idx}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: "12px",
                                      marginBottom: "3px",
                                      fontSize: "11px",
                                      color: "#1e3a8a",
                                    }}
                                  >
                                    <span>{s.filialDisplayName}</span>
                                    <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                                      {s.quantity} un. {formatCurrency(s.revenue)}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            flex: "1 1 220px",
                            minWidth: 220,
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                            padding: "10px 10px 8px 12px",
                          }}
                        >
                          <p style={{ margin: "0 0 6px 0", fontSize: "10px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                            Mês anterior
                          </p>
                          {data.comparisonDayQuantity > 0 || data.comparisonDayRevenue > 0 ? (
                            <>
                              <p style={{ margin: "0 0 2px 0", fontSize: "16px", fontWeight: 700, color: "#9ca3af" }}>
                                {formatCurrency(data.comparisonDayRevenue)}
                              </p>
                              <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 600, color: "#a8a29e" }}>
                                {data.comparisonDayQuantity}{" "}
                                {data.comparisonDayQuantity === 1 ? "unidade" : "unidades"}
                              </p>
                            </>
                          ) : (
                            <p style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 600, color: "#cbd5e1" }}>
                              Sem venda
                            </p>
                          )}
                          {data.comparisonSalesByFilial && data.comparisonSalesByFilial.length > 0 ? (
                            <div style={{ paddingTop: "6px", borderTop: "1px solid #e2e8f0" }}>
                              <p style={{ margin: "0 0 4px 0", fontSize: "10px", fontWeight: 700, color: "#94a3b8" }}>
                                Onde vendeu
                              </p>
                              {data.comparisonSalesByFilial.map(
                                (
                                  s: {
                                    filialDisplayName: string;
                                    quantity: number;
                                    revenue: number;
                                  },
                                  idx: number,
                                ) => (
                                  <div
                                    key={idx}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: "12px",
                                      marginBottom: "3px",
                                      fontSize: "11px",
                                      color: "#9ca3af",
                                    }}
                                  >
                                    <span>{s.filialDisplayName}</span>
                                    <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                                      {s.quantity} un. {formatCurrency(s.revenue)}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          ) : null}
                        </div>
                        </div>

                        <div
                          style={{
                            paddingTop: "8px",
                            borderTop: "1px solid #f1f5f9",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "12px 20px",
                            fontSize: "10px",
                            color: "#94a3b8",
                            fontWeight: 500,
                          }}
                        >
                          <span style={{ whiteSpace: "nowrap" }}>
                            Acumulado no período: {formatCurrency(data.vendasReais)} ·{" "}
                            {data.cumulativePeriodQuantity} un.
                          </span>
                          <span style={{ whiteSpace: "nowrap" }}>
                            Acumulado mês anterior: {formatCurrency(data.projecao)} ·{" "}
                            {data.quantityProjection} un.
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="vendasReais"
                  name="Vendas no período"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (!payload.hasSales || cy == null) return null;
                    return <circle cx={cx} cy={cy} r={3} fill="#2563eb" />;
                  }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="projecao"
                  name={comparisonLegendLabel}
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

        {stockProgressChart.length > 0 && (
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Movimento de estoque no período</h3>
            <p className={styles.chartSubtitle}>
              Barras · entradas (romaneios), saídas por venda e saídas de mov. de estoque por dia · Linha · saldo estimado (geral).
              Ponto vermelho indica dia sem estoque.
            </p>
            <div className={styles.chartLegend}>
              <span className={styles.chartLegendItem}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#22c55e", borderRadius: 2 }} />{" "}
                Entradas
              </span>
              <span className={styles.chartLegendItem}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#ef4444", borderRadius: 2 }} />{" "}
                Saídas (vendas)
              </span>
              <span className={styles.chartLegendItem}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#f97316", borderRadius: 2 }} />{" "}
                Saídas (mov. estoque)
              </span>
              <span className={styles.chartLegendItem}>
                <span className={styles.chartLegendDotBlue} /> Saldo geral (un.)
              </span>
              <span className={styles.chartLegendItem}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#dc2626", borderRadius: "50%" }} />{" "}
                Sem estoque
              </span>
            </div>
            <div className={styles.chartWrapper}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={stockProgressChart} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  {chartMonthBoundaryIsos.map((iso) => (
                    <ReferenceLine key={`st-${iso}`} x={iso} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" />
                  ))}
                  <XAxis
                    dataKey="isoDay"
                    type="category"
                    ticks={chartTickIsos}
                    stroke="#94a3b8"
                    style={{ fontSize: "11px" }}
                    tick={{ fill: "#64748b" }}
                    tickFormatter={(iso) =>
                      format(new Date(`${iso}T12:00:00`), isMultiMonthRange ? "dd/MM" : "dd", {
                        locale: ptBR,
                      })
                    }
                  />
                  <YAxis
                    yAxisId="flow"
                    orientation="right"
                    hide
                    domain={[0, "dataMax + 2"]}
                  />
                  <YAxis
                    yAxisId="stock"
                    orientation="left"
                    stroke="#2563eb"
                    style={{ fontSize: "11px" }}
                    tick={{ fill: "#2563eb" }}
                    tickFormatter={(v) => formatInteger(v)}
                  />
                  <Tooltip
                    wrapperStyle={{ outline: "none" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as (typeof stockProgressChart)[0];
                      const raw = p._raw;
                      const filialRows = sortedFiliaisByOrder(
                        Object.entries(raw.stockByFilial).map(([name, qty]) => ({
                          filialDisplayName: name,
                          filial: name,
                          stock: qty,
                        })),
                      );
                      const entryQtyByFilial = new Map<string, number>();
                      raw.entriesByFilial.forEach((e) => {
                        const k = (e.filialDisplayName || "").toUpperCase().trim();
                        if (k) entryQtyByFilial.set(k, (entryQtyByFilial.get(k) ?? 0) + e.qty);
                      });
                      const saleQtyByFilial = new Map<string, number>();
                      raw.salesByFilial.forEach((s) => {
                        const k = (s.filialDisplayName || "").toUpperCase().trim();
                        if (k) saleQtyByFilial.set(k, (saleQtyByFilial.get(k) ?? 0) + s.qty);
                      });
                      const exitQtyByFilial = new Map<string, number>();
                      raw.exitsByFilial.forEach((x) => {
                        const k = (x.filialDisplayName || "").toUpperCase().trim();
                        if (k) exitQtyByFilial.set(k, (exitQtyByFilial.get(k) ?? 0) + x.qty);
                      });
                      return (
                        <div
                          style={{
                            backgroundColor: "#fff",
                            border: `1px solid ${raw.outOfStock ? "#fca5a5" : "#e2e8f0"}`,
                            borderRadius: "8px",
                            padding: "12px 14px",
                            fontSize: "12px",
                            minWidth: 320,
                            maxWidth: 480,
                          }}
                        >
                          <p style={{ margin: "0 0 8px 0", fontWeight: 600, color: "#64748b", fontSize: "11px" }}>
                            {p.dateLong}
                          </p>
                          {raw.outOfStock && (
                            <p style={{ margin: "0 0 8px 0", fontWeight: 700, color: "#dc2626", fontSize: "11px" }}>
                              Sem estoque neste dia
                            </p>
                          )}
                          <p style={{ margin: "0 4px 4px 0", color: "#15803d", fontWeight: 600 }}>
                            +{formatInteger(raw.entries)} entradas
                          </p>
                          <p style={{ margin: "0 4px 2px 0", color: "#b91c1c", fontWeight: 600 }}>
                            −{formatInteger(raw.sales)} saídas (vendas)
                          </p>
                          {raw.stockExits > 0 && (
                            <p style={{ margin: "0 4px 10px 0", color: "#b91c1c", fontWeight: 600 }}>
                              −{formatInteger(raw.stockExits)} saídas (mov. estoque)
                            </p>
                          )}
                          {raw.stockExits === 0 && <div style={{ marginBottom: "10px" }} />}
                          <p style={{ margin: "0 0 8px 0", fontWeight: 700, color: raw.outOfStock ? "#dc2626" : "#1d4ed8" }}>
                            Saldo geral (fim do dia): {formatInteger(raw.stockGeral)} un.
                          </p>
                          {filialRows.length > 0 && (
                            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                              <p style={{ margin: "0 0 6px 0", fontSize: "10px", fontWeight: 700, color: "#94a3b8" }}>
                                Saldo por filial · <span style={{ fontWeight: 600 }}>+</span> entrada ·{" "}
                                <span style={{ fontWeight: 600 }}>−</span> venda ·{" "}
                                <span style={{ fontWeight: 600 }}>↓</span> mov. estoque
                              </p>
                              {filialRows.map((f) => {
                                const fk = (f.filialDisplayName || "").toUpperCase().trim();
                                const ent = entryQtyByFilial.get(fk) ?? 0;
                                const sai = saleQtyByFilial.get(fk) ?? 0;
                                const ext = exitQtyByFilial.get(fk) ?? 0;
                                return (
                                  <div
                                    key={f.filialDisplayName}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      gap: "10px",
                                      marginBottom: "4px",
                                      fontSize: "11px",
                                      color: "#475569",
                                    }}
                                  >
                                    <span style={{ flex: "1 1 auto", minWidth: 0 }}>{f.filialDisplayName}</span>
                                    <span
                                      style={{
                                        display: "flex",
                                        gap: "8px",
                                        flexShrink: 0,
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      {ent > 0 ? (
                                        <span style={{ color: "#15803d", fontWeight: 700 }}>+{formatInteger(ent)}</span>
                                      ) : null}
                                      {sai > 0 ? (
                                        <span style={{ color: "#b91c1c", fontWeight: 700 }}>−{formatInteger(sai)}</span>
                                      ) : null}
                                      {ext > 0 ? (
                                        <span style={{ color: "#ea580c", fontWeight: 700 }}>↓{formatInteger(ext)}</span>
                                      ) : null}
                                    </span>
                                    <span style={{ fontWeight: 600, flexShrink: 0, textAlign: "right" }}>
                                      {formatInteger(f.stock ?? 0)} un.
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar yAxisId="flow" dataKey="entries" stackId="mov" name="Entradas" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="flow" dataKey="salesFlow" stackId="mov" name="Saídas (vendas)" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="flow" dataKey="stockExitFlow" stackId="mov" name="Saídas (mov. estoque)" fill="#f97316" radius={[0, 0, 0, 0]} />
                  <Line
                    yAxisId="stock"
                    type="monotone"
                    dataKey="stockGeral"
                    name="Saldo geral"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={(dotProps) => {
                      const { cx, cy, payload } = dotProps as { cx: number; cy: number; payload: (typeof stockProgressChart)[0] };
                      if (payload.outOfStock) {
                        return <circle key={`dot-${payload.isoDay}`} cx={cx} cy={cy} r={4} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />;
                      }
                      return <circle key={`dot-${payload.isoDay}`} cx={cx} cy={cy} r={2} fill="#2563eb" />;
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Modal Preços de venda */}
      {modalPrecoOpen && (
        <div className={styles.modalOverlay} onClick={() => !confirmPayload && setModalPrecoOpen(false)} role="dialog" aria-modal="true" aria-labelledby="modal-preco-title">
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-preco-title" className={styles.modalTitle}>Editar preços de venda</h2>
            {modalError && <div className={styles.modalError}>{modalError}</div>}
            {modalLoading && <div className={styles.modalLoading}>Carregando…</div>}
            {!modalLoading && precos.length === 0 && !modalError && <div className={styles.modalEmpty}>Nenhum preço de venda encontrado para este produto.</div>}
            {!modalLoading && precos.length > 0 && (
              <>
                <div className={styles.modalList}>
                  {precos.map((item) => {
                    const key = `${item.codTabela}-${item.campo}`;
                    return (
                      <div key={key} className={styles.modalRow}>
                        <span className={styles.modalRowLabel}>{item.descTabela || item.codTabela}</span>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={editedPrecos[key] ?? item.valor.toFixed(2).replace('.', ',')}
                          onChange={(e) => setEditedPrecos((prev) => ({ ...prev, [key]: e.target.value }))}
                          inputMode="decimal"
                        />
                      </div>
                    );
                  })}
                </div>
                {confirmPayload && confirmPayload.type === 'preco' && (
                  <div className={styles.modalConfirmMessage}>
                    Confirmar alteração: <strong>{formatCurrency(confirmPayload.valorAnterior)}</strong> → <strong>{formatCurrency(confirmPayload.novoValor)}</strong>?
                  </div>
                )}
                <div className={styles.modalActions}>
                  {confirmPayload && confirmPayload.type === 'preco' ? (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setConfirmPayload(null)} disabled={saving}>Cancelar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={executeUpdate} disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setModalPrecoOpen(false)}>Fechar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={handleSavePreco} disabled={!hasPrecoChange}>Salvar</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal Custos unitários */}
      {canSeeCusto && modalCustoOpen && (
        <div className={styles.modalOverlay} onClick={() => !confirmPayload && setModalCustoOpen(false)} role="dialog" aria-modal="true" aria-labelledby="modal-custo-title">
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-custo-title" className={styles.modalTitle}>Editar custos unitários</h2>
            {modalError && <div className={styles.modalError}>{modalError}</div>}
            {modalLoading && <div className={styles.modalLoading}>Carregando…</div>}
            {!modalLoading && custos.length === 0 && !modalError && <div className={styles.modalEmpty}>Nenhum custo encontrado para este produto.</div>}
            {!modalLoading && custos.length > 0 && (
              <>
                <div className={styles.modalList}>
                  {custos.map((item) => {
                    const key = `${item.codTabela}-${item.campo}`;
                    return (
                      <div key={key} className={styles.modalRow}>
                        <span className={styles.modalRowLabel}>{item.descTabela || item.codTabela}</span>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={editedCustos[key] ?? item.valor.toFixed(2).replace('.', ',')}
                          onChange={(e) => setEditedCustos((prev) => ({ ...prev, [key]: e.target.value }))}
                          inputMode="decimal"
                        />
                      </div>
                    );
                  })}
                </div>
                {confirmPayload && confirmPayload.type === 'custo' && (
                  <div className={styles.modalConfirmMessage}>
                    Confirmar alteração: <strong>{formatCurrency(confirmPayload.valorAnterior)}</strong> → <strong>{formatCurrency(confirmPayload.novoValor)}</strong>?
                  </div>
                )}
                <div className={styles.modalActions}>
                  {confirmPayload && confirmPayload.type === 'custo' ? (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setConfirmPayload(null)} disabled={saving}>Cancelar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={executeUpdate} disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setModalCustoOpen(false)}>Fechar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={handleSaveCusto} disabled={!hasCustoChange}>Salvar</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
