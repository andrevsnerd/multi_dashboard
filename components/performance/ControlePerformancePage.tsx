"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { endOfMonth, startOfMonth } from "date-fns";
import type { CompanyKey } from "@/lib/config/company";
import GoalsModal from "@/components/dashboard/GoalsModal";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import styles from "./ControlePerformancePage.module.css";

interface CategoryData {
  pct: number;
  qtdeDelta: number;
}

interface FilialRow {
  filial: string;
  displayName: string;
  meta: number;
  vendas: number;
  qtde: number;
  projecao: number;
  projecaoPct: number | null;
  categories: Record<string, CategoryData>;
}

interface PerformanceData {
  filiais: FilialRow[];
  categories: string[];
  daysElapsed: number;
  totalDaysInMonth: number;
  month: number;
  year: number;
  totals?: {
    vendas: number;
    qtde: number;
  };
}

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

const OUTROS_CATEGORIES = new Set([
  "CAPAS E ACESSORIOS P/ CEL",
  "HOME",
  "PAPELARIA",
  "ELETRONICOS",
  "PERFUMARIA",
  "SEDA PREMIUM",
]);
const OUTROS_LABEL = "OUTROS";
const OUTROS_TOOLTIP = `Composição do OUTROS:\n- ${Array.from(OUTROS_CATEGORIES).join("\n- ")}`;

function getCategoryHeaderLabel(category: string): string {
  const normalized = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (normalized.includes("APROVEITAMENTO") && normalized.includes("LENC")) return "AP. LENÇOS";
  return category;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ControlePerformancePage({ companyKey, companyName: _companyName }: Props) {
  const initialRange = useMemo(() => {
    const currentMonth = getCurrentMonthRange();
    return {
      startDate: currentMonth.start,
      endDate: currentMonth.end,
    };
  }, []);
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const selectedMonth = range.startDate.getMonth();
  const selectedYear = range.startDate.getFullYear();

  const getRowPctExtremes = useCallback((categories: string[], getPct: (cat: string) => number | null) => {
    const pcts = categories
      .map(cat => getPct(cat))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    if (pcts.length === 0) {
      return {
        max: null as number | null,
        min: null as number | null,
        secondMin: null as number | null,
      };
    }

    let max = pcts[0];
    let min = pcts[0];
    for (let i = 1; i < pcts.length; i++) {
      const v = pcts[i];
      if (v > max) max = v;
      if (v < min) min = v;
    }

    // secondMin is the smallest value strictly greater than min (distinct rank)
    let secondMin: number | null = null;
    for (let i = 0; i < pcts.length; i++) {
      const v = pcts[i];
      if (v === min) continue;
      if (secondMin === null || v < secondMin) secondMin = v;
    }

    return { max, min, secondMin };
  }, []);

  const displayedCategories = useMemo(() => {
    if (!data) return [];
    const outros = data.categories.filter(c => OUTROS_CATEGORIES.has(c));
    const remaining = data.categories.filter(c => !OUTROS_CATEGORIES.has(c));
    return outros.length > 0 ? [...remaining, OUTROS_LABEL] : remaining;
  }, [data]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/controle-performance?company=${companyKey}&month=${selectedMonth}&year=${selectedYear}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Erro ao carregar dados");
      const json = await res.json() as PerformanceData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [companyKey, selectedMonth, selectedYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Computed totals
  const totals = useMemo(() => {
    if (!data) return null;
    const filiais = data.filiais;
    const totalVendas = data.totals?.vendas ?? filiais.reduce((s, f) => s + f.vendas, 0);
    const totalQtde = data.totals?.qtde ?? filiais.reduce((s, f) => s + f.qtde, 0);
    const totalMeta = filiais.reduce((s, f) => s + f.meta, 0);
    const totalProjecao = filiais.reduce((s, f) => s + f.projecao, 0);
    const totalProjecaoPct = totalMeta > 0 ? (totalProjecao / totalMeta) * 100 : null;

    // Average % per category across filials, sum of deltas
    const categoryAvg: Record<string, { pct: number; qtdeDelta: number }> = {};
    data.categories.forEach(cat => {
      const pcts = filiais.map(f => f.categories[cat]?.pct ?? 0);
      const avgPct = pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : 0;
      const totalDelta = filiais.reduce((s, f) => s + (f.categories[cat]?.qtdeDelta ?? 0), 0);
      categoryAvg[cat] = { pct: avgPct, qtdeDelta: totalDelta / filiais.length };
    });

    return { totalVendas, totalQtde, totalMeta, totalProjecaoPct, categoryAvg };
  }, [data]);

  const handleGoalsModalClose = () => {
    setIsGoalsModalOpen(false);
    fetchData();
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.monthSelector}>
          <DateRangeFilter
            value={range}
            onChange={(nextRange) => {
              const baseDate = nextRange.startDate;
              setRange({
                startDate: startOfMonth(baseDate),
                endDate: endOfMonth(baseDate),
              });
            }}
          />
        </div>
        <button
          type="button"
          className={styles.goalsButton}
          onClick={() => setIsGoalsModalOpen(true)}
        >
          Editar Metas
        </button>
      </div>

      {/* Summary Cards */}
      {data && totals && (
        <div className={styles.summaryCards}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>FILIAIS</span>
            <span className={styles.cardValue}>{data.filiais.length}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>TOTAL VENDAS</span>
            <span className={styles.cardValue}>{formatCurrency(totals.totalVendas)}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>META GLOBAL</span>
            <span className={styles.cardValue}>{formatCurrency(totals.totalMeta)}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>QTDE TOTAL</span>
            <span className={styles.cardValue}>{totals.totalQtde.toLocaleString("pt-BR")}</span>
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {loading && <div className={styles.loadingMsg}>Carregando...</div>}
      {error && <div className={styles.errorMsg}>{error}</div>}

      {/* Table */}
      {!loading && data && totals && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thFilial}>FILIAL</th>
                <th className={styles.th}>META</th>
                <th className={styles.th}>PROJEÇÃO</th>
                <th className={styles.th}>VENDAS</th>
                <th className={styles.thQtde}>QTDE</th>
                {displayedCategories.map(cat => (
                  <th
                    key={cat}
                    className={styles.thCat}
                    title={cat === OUTROS_LABEL ? OUTROS_TOOLTIP : undefined}
                  >
                    {getCategoryHeaderLabel(cat)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.filiais.map(row => {
                const getDisplayedPct = (cat: string): number | null => {
                  if (cat === OUTROS_LABEL) {
                    const entries = Array.from(OUTROS_CATEGORIES)
                      .map(c => row.categories[c]?.pct)
                      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                    if (entries.length === 0) return null;
                    const avg = entries.reduce((s, v) => s + v, 0) / entries.length;
                    return Math.round(avg);
                  }
                  const v = row.categories[cat]?.pct;
                  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
                };

                const extremes = getRowPctExtremes(displayedCategories, getDisplayedPct);
                return (
                  <tr key={row.filial} className={styles.bodyRow}>
                  <td className={styles.tdFilial}>{row.displayName}</td>
                  <td className={styles.td}>{formatCurrency(row.meta)}</td>
                  <td className={styles.td}>
                    {row.projecaoPct !== null ? (
                      <span className={`${styles.projecaoBadge} ${row.projecaoPct >= 100 ? styles.badgeGreen : styles.badgeRed}`}>
                        {row.projecaoPct >= 100 ? '↗' : '↘'} {row.projecaoPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className={styles.noMeta}>—</span>
                    )}
                  </td>
                  <td className={styles.td}>{formatCurrency(row.vendas)}</td>
                  <td className={styles.tdQtde}>{row.qtde.toLocaleString("pt-BR")}</td>
                  {displayedCategories.map(cat => {
                    if (cat === OUTROS_LABEL) {
                      const selected = Array.from(OUTROS_CATEGORIES)
                        .map(c => row.categories[c])
                        .filter((v): v is CategoryData => !!v);
                      if (selected.length === 0) {
                        return <td key={cat} className={styles.tdCat}>—</td>;
                      }
                      const displayedPct = getDisplayedPct(OUTROS_LABEL);
                      const qtdeDeltaSum = selected.reduce((s, v) => s + (v.qtdeDelta ?? 0), 0);
                      const isPositive = qtdeDeltaSum >= 0;
                      const isMax = extremes.max !== null && displayedPct !== null && displayedPct === extremes.max;
                      const isMin = extremes.min !== null && displayedPct !== null && displayedPct === extremes.min;
                      const isSecondMin = extremes.secondMin !== null && displayedPct !== null && displayedPct === extremes.secondMin;
                      const highlightClass =
                        isMax && !isMin ? styles.tdCatMax
                        : isMin && !isMax ? styles.tdCatMin
                        : isSecondMin ? styles.tdCatSecondMin
                        : "";
                      return (
                        <td
                          key={cat}
                          className={`${styles.tdCat} ${highlightClass}`}
                          title={OUTROS_TOOLTIP}
                        >
                          <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                          <span
                            className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                          >
                            {Math.abs(Math.round(qtdeDeltaSum))}%
                          </span>
                        </td>
                      );
                    }

                    const catData = row.categories[cat];
                    if (!catData) {
                      return <td key={cat} className={styles.tdCat}>—</td>;
                    }
                    const isPositive = catData.qtdeDelta >= 0;
                    const displayedPct = getDisplayedPct(cat);
                    const isMax = extremes.max !== null && displayedPct !== null && displayedPct === extremes.max;
                    const isMin = extremes.min !== null && displayedPct !== null && displayedPct === extremes.min;
                    const isSecondMin = extremes.secondMin !== null && displayedPct !== null && displayedPct === extremes.secondMin;
                    const highlightClass =
                      isMax && !isMin ? styles.tdCatMax
                      : isMin && !isMax ? styles.tdCatMin
                      : isSecondMin ? styles.tdCatSecondMin
                      : "";
                    return (
                      <td key={cat} className={`${styles.tdCat} ${highlightClass}`}>
                        <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                        <span
                          className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                        >
                          {Math.abs(Math.round(catData.qtdeDelta))}%
                        </span>
                      </td>
                    );
                  })}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className={styles.totalsRow}>
                <td className={styles.tdFilial}>MÉDIA / TOTAL</td>
                <td className={styles.td}>{formatCurrency(totals.totalMeta)}</td>
                <td className={styles.td}>
                  {totals.totalProjecaoPct !== null ? (
                    <span className={`${styles.projecaoBadge} ${totals.totalProjecaoPct >= 100 ? styles.badgeGreen : styles.badgeRed}`}>
                      {totals.totalProjecaoPct >= 100 ? '↗' : '↘'} {totals.totalProjecaoPct.toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
                <td className={styles.td}>{formatCurrency(totals.totalVendas)}</td>
                <td className={styles.tdQtde}>{totals.totalQtde.toLocaleString("pt-BR")}</td>
                {(() => {
                  const getDisplayedPct = (cat: string): number | null => {
                    if (cat === OUTROS_LABEL) {
                      const entries = Array.from(OUTROS_CATEGORIES)
                        .map(c => totals.categoryAvg[c]?.pct)
                        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                      if (entries.length === 0) return null;
                      const avg = entries.reduce((s, v) => s + v, 0) / entries.length;
                      return Math.round(avg);
                    }
                    const v = totals.categoryAvg[cat]?.pct;
                    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
                  };

                  const extremes = getRowPctExtremes(displayedCategories, getDisplayedPct);

                  return displayedCategories.map(cat => {
                    if (cat === OUTROS_LABEL) {
                      const selected = Array.from(OUTROS_CATEGORIES)
                        .map(c => totals.categoryAvg[c])
                        .filter((v): v is { pct: number; qtdeDelta: number } => !!v);
                      if (selected.length === 0) return <td key={cat} className={styles.tdCat}>—</td>;

                      const displayedPct = getDisplayedPct(OUTROS_LABEL);
                      const qtdeDeltaSum = selected.reduce((s, v) => s + (v.qtdeDelta ?? 0), 0);
                      const isPositive = qtdeDeltaSum >= 0;
                      const isMax = extremes.max !== null && displayedPct !== null && displayedPct === extremes.max;
                      const isMin = extremes.min !== null && displayedPct !== null && displayedPct === extremes.min;
                      const isSecondMin = extremes.secondMin !== null && displayedPct !== null && displayedPct === extremes.secondMin;
                      const highlightClass =
                        isMax && !isMin ? styles.tdCatMax
                        : isMin && !isMax ? styles.tdCatMin
                        : isSecondMin ? styles.tdCatSecondMin
                        : "";

                      return (
                        <td
                          key={cat}
                          className={`${styles.tdCat} ${highlightClass}`}
                          title={OUTROS_TOOLTIP}
                        >
                          <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                          <span
                            className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                          >
                            {(Math.abs(qtdeDeltaSum) < 10 ? Math.abs(qtdeDeltaSum).toFixed(1) : Math.round(Math.abs(qtdeDeltaSum)))}%
                          </span>
                        </td>
                      );
                    }

                    const catData = totals.categoryAvg[cat];
                    if (!catData) return <td key={cat} className={styles.tdCat}>—</td>;
                    const isPositive = catData.qtdeDelta >= 0;
                    const displayedPct = getDisplayedPct(cat);
                    const isMax = extremes.max !== null && displayedPct !== null && displayedPct === extremes.max;
                    const isMin = extremes.min !== null && displayedPct !== null && displayedPct === extremes.min;
                    const isSecondMin = extremes.secondMin !== null && displayedPct !== null && displayedPct === extremes.secondMin;
                    const highlightClass =
                      isMax && !isMin ? styles.tdCatMax
                      : isMin && !isMax ? styles.tdCatMin
                      : isSecondMin ? styles.tdCatSecondMin
                      : "";
                    return (
                      <td key={cat} className={`${styles.tdCat} ${highlightClass}`}>
                        <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                        <span
                          className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                        >
                          {(Math.abs(catData.qtdeDelta) < 10 ? Math.abs(catData.qtdeDelta).toFixed(1) : Math.round(Math.abs(catData.qtdeDelta)))}%
                        </span>
                      </td>
                    );
                  });
                })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <GoalsModal
        companyKey={companyKey}
        isOpen={isGoalsModalOpen}
        onClose={handleGoalsModalClose}
        monthYear={{ month: selectedMonth, year: selectedYear }}
      />
    </div>
  );
}
