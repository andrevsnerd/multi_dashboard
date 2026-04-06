"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { CompanyKey } from "@/lib/config/company";
import GoalsModal from "@/components/dashboard/GoalsModal";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import { formatDateForQuery, getCurrentMonthRange } from "@/lib/utils/date";
import { exportControlePerformanceXlsx } from "@/lib/utils/exportControlePerformanceXlsx";
import {
  OUTROS_LABEL,
  filterOutrosKeys,
  getOutrosTooltip,
  isOutrosCategory,
} from "@/lib/performance/outrosCategories";
import styles from "./ControlePerformancePage.module.css";

interface CategoryData {
  pct: number;
  deltaPct: number | null;
}

interface FilialRow {
  filial: string;
  displayName: string;
  meta: number;
  vendas: number;
  vendasPrevious: number;
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
    vendasPrevious: number;
    qtde: number;
  };
}

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

const CATEGORY_COLORS = [
  "#1565c0",
  "#e65100",
  "#00695c",
  "#4527a0",
  "#ad1457",
  "#37474f",
  "#4e342e",
  "#1b5e20",
  "#00838f",
  "#6d4c41",
];

function getCategoryHeaderLabel(category: string): string {
  const normalized = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (normalized.includes("APROVEITAMENTO") && normalized.includes("LENC")) return "Ap. Lenços";
  return category
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getComparisonPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getComparisonBadge(
  current: number,
  previous: number
): { kind: "pct"; value: number } | null {
  const pct = getComparisonPct(current, previous);
  if (pct !== null) return { kind: "pct", value: pct };
  return null;
}

export default function ControlePerformancePage({ companyKey, companyName: _companyName }: Props) {
  const router = useRouter();
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
  const [exporting, setExporting] = useState(false);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [comparisonMode, setComparisonMode] = useState<"month" | "year">("month");
  const selectedMonth = range.startDate.getMonth();
  const selectedYear = range.startDate.getFullYear();
  const comparisonLabel = comparisonMode === "month"
    ? "mês anterior"
    : "mesmo período do ano anterior";

  const outrosTooltip = useMemo(() => getOutrosTooltip(companyKey), [companyKey]);

  const outrosKeys = useMemo(
    () => (data ? filterOutrosKeys(data.categories, companyKey) : []),
    [data, companyKey]
  );

  const navigateToFilial = (filial: string) => {
    const params = new URLSearchParams({
      filial,
      month: String(selectedMonth),
      year: String(selectedYear),
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
      compare: comparisonMode,
    });
    router.push(`/${companyKey}/controle-performance/filial?${params.toString()}`);
  };

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
    const outros = data.categories.filter(c => isOutrosCategory(companyKey, c));
    const remaining = data.categories.filter(c => !isOutrosCategory(companyKey, c));
    return outros.length > 0 ? [...remaining, OUTROS_LABEL] : remaining;
  }, [data, companyKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = formatDateForQuery(range.startDate);
      const end = formatDateForQuery(range.endDate);
      const res = await fetch(
        `/api/controle-performance?company=${companyKey}&month=${selectedMonth}&year=${selectedYear}&start=${start}&end=${end}&compare=${comparisonMode}`,
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
  }, [companyKey, selectedMonth, selectedYear, comparisonMode, range.startDate, range.endDate]);

  const handleExportXlsx = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      await exportControlePerformanceXlsx({
        companyKey,
        range: { startDate: range.startDate, endDate: range.endDate },
        comparisonMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar Excel");
    } finally {
      setExporting(false);
    }
  }, [companyKey, range.startDate, range.endDate, comparisonMode, exporting]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Computed totals
  const totals = useMemo(() => {
    if (!data) return null;
    const filiais = data.filiais;
    const totalVendas = data.totals?.vendas ?? filiais.reduce((s, f) => s + f.vendas, 0);
    const totalVendasPrevious = data.totals?.vendasPrevious ?? filiais.reduce((s, f) => s + f.vendasPrevious, 0);
    const totalQtde = data.totals?.qtde ?? filiais.reduce((s, f) => s + f.qtde, 0);
    const totalMeta = filiais.reduce((s, f) => s + f.meta, 0);
    const totalProjecao = filiais.reduce((s, f) => s + f.projecao, 0);
    const totalProjecaoPct = totalMeta > 0 ? (totalProjecao / totalMeta) * 100 : null;

    // Average % per category across filials
    const categoryAvg: Record<string, { pct: number; deltaPct: number | null }> = {};
    data.categories.forEach(cat => {
      const pcts = filiais.map(f => f.categories[cat]?.pct ?? 0);
      const avgPct = pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : 0;
      const deltaPcts = filiais
        .map(f => f.categories[cat]?.deltaPct)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const avgDeltaPct = deltaPcts.length > 0
        ? deltaPcts.reduce((s, v) => s + v, 0) / deltaPcts.length
        : null;
      categoryAvg[cat] = { pct: avgPct, deltaPct: avgDeltaPct };
    });

    return { totalVendas, totalVendasPrevious, totalQtde, totalMeta, totalProjecao, totalProjecaoPct, categoryAvg };
  }, [data]);

  const sortedFiliais = useMemo(() => {
    if (!data) return [];
    return [...data.filiais].sort((a, b) => {
      const aGrowth = getComparisonPct(a.vendas, a.vendasPrevious);
      const bGrowth = getComparisonPct(b.vendas, b.vendasPrevious);
      if (aGrowth === null && bGrowth === null) return a.displayName.localeCompare(b.displayName, "pt-BR");
      if (aGrowth === null) return 1;
      if (bGrowth === null) return -1;
      return bGrowth - aGrowth;
    });
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
              setRange(nextRange);
            }}
          />
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.exportButton}
            onClick={handleExportXlsx}
            disabled={loading || exporting}
            title="Exporta um Excel com resumo, produtos e abas por filial"
          >
            {exporting ? "Exportando..." : "Exportar Excel"}
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setViewMode(v => v === "cards" ? "table" : "cards")}
          >
            Tabela
          </button>
          <button
            type="button"
            className={styles.goalsButton}
            onClick={() => setIsGoalsModalOpen(true)}
          >
            Editar Metas
          </button>
        </div>
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
            <span className={styles.cardLabel}>PRODÚTOS ÚNICOS</span>
            <span className={styles.cardValue}>{totals.totalQtde.toLocaleString("pt-BR")}</span>
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {loading && <div className={styles.loadingMsg}>Carregando...</div>}
      {error && <div className={styles.errorMsg}>{error}</div>}

      {/* Comparison toggle */}
      {!loading && data && (
        <div className={styles.comparisonToggleRow}>
          <span className={styles.comparisonToggleLabel}>Comparação:</span>
          <div className={styles.comparisonToggleGroup}>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${comparisonMode === "month" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setComparisonMode("month")}
            >
              Mês
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${comparisonMode === "year" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setComparisonMode("year")}
            >
              Ano
            </button>
          </div>
        </div>
      )}

      {/* Cards View */}
      {!loading && data && totals && viewMode === "cards" && (
        <div className={styles.cardsGrid}>
          {sortedFiliais.map(row => {
            const variation = getComparisonBadge(row.vendas, row.vendasPrevious);
            const salesPct = row.projecaoPct;
            const barPct = salesPct !== null ? Math.min(salesPct, 100) : 0;
            const barClass = salesPct !== null
              ? (salesPct >= 100 ? styles.fillGreen : salesPct >= 75 ? styles.fillOrange : styles.fillRed)
              : styles.fillRed;
            const metaPctClass = salesPct !== null
              ? (salesPct >= 100 ? styles.metaPctGreen : salesPct >= 75 ? styles.metaPctOrange : styles.metaPctRed)
              : "";

            const getCardCatPct = (cat: string): number | null => {
              if (cat === OUTROS_LABEL) {
                const entries = outrosKeys
                  .map(c => row.categories[c]?.pct)
                  .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                if (entries.length === 0) return null;
                return Math.round(entries.reduce((s, v) => s + v, 0) / entries.length);
              }
              const v = row.categories[cat]?.pct;
              return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
            };

            const getCardCatDelta = (cat: string): number | null => {
              if (cat === OUTROS_LABEL) {
                const deltas = outrosKeys
                  .map(c => row.categories[c]?.deltaPct)
                  .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                if (deltas.length === 0) return null;
                return deltas.reduce((s, v) => s + v, 0) / deltas.length;
              }
              const d = row.categories[cat]?.deltaPct;
              return typeof d === "number" && Number.isFinite(d) ? d : null;
            };

            return (
              <div
                key={row.filial}
                className={`${styles.branchCard} ${styles.branchCardClickable}`}
                onClick={() => navigateToFilial(row.filial)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" && navigateToFilial(row.filial)}
              >
                {/* Left: filial name + variation */}
                <div className={styles.cardLeft}>
                  <span className={styles.cardFilialName}>{row.displayName}</span>
                  {variation && (
                    <span
                      className={`${styles.variationBadge} ${
                        variation.value >= 0
                          ? styles.variationPos
                          : styles.variationNeg
                      }`}
                    >
                      {`${variation.value >= 0 ? "↗" : "↘"} ${formatSignedPct(variation.value)}`}
                    </span>
                  )}
                </div>

                {/* Middle: revenue + progress bar */}
                <div className={styles.cardMiddle}>
                  <div className={styles.cardRevenue}>{formatCurrency(row.vendas)}</div>
                  <div className={styles.cardQtde}>{row.qtde.toLocaleString("pt-BR")} itens</div>
                  {row.meta > 0 && salesPct !== null && (
                    <>
                      <div className={styles.cardMetaRow}>
                        <span className={styles.cardMetaValue}>@ {formatCurrency(row.meta)}</span>
                        <span className={`${styles.cardMetaPct} ${metaPctClass}`}>{salesPct.toFixed(1)}%</span>
                      </div>
                      <div className={styles.progressBarTrack}>
                        <div
                          className={`${styles.progressBarFill} ${barClass}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Right: categories */}
                <div className={styles.cardCategoriesSection}>
                  {displayedCategories.map((cat, idx) => {
                    const pct = getCardCatPct(cat);
                    const delta = getCardCatDelta(cat);
                    if (pct === null) return null;
                    const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                    const catPillTrendClass = delta === null
                      ? ""
                      : (delta >= 0 ? styles.catPillUp : styles.catPillDown);
                    return (
                      <span
                        key={cat}
                        className={`${styles.catPill} ${catPillTrendClass}`}
                        title={cat === OUTROS_LABEL ? outrosTooltip : undefined}
                        style={{
                          backgroundColor: delta === null ? hexToRgba(color, 0.12) : undefined,
                          borderColor: delta === null ? hexToRgba(color, 0.35) : undefined,
                          color: delta === null ? color : undefined,
                        }}
                      >
                        {getCategoryHeaderLabel(cat)} {pct}%
                        {delta !== null && (
                          <span
                            className={delta >= 0 ? styles.catArrowUp : styles.catArrowDown}
                          >
                            {delta >= 0 ? " ↑" : " ↓"}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {!loading && data && totals && viewMode === "table" && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thFilial}>FILIAL</th>
                <th className={styles.th}>META</th>
                <th className={styles.th}>PROJEÇÃO META</th>
                <th className={styles.th}>PROJEÇÃO MÊS</th>
                <th className={`${styles.th} ${styles.thVendas}`}>VENDAS</th>
                <th className={styles.thQtde}>QTDE</th>
                {displayedCategories.map(cat => (
                  <th
                    key={cat}
                    className={styles.thCat}
                    title={cat === OUTROS_LABEL ? outrosTooltip : undefined}
                  >
                    {getCategoryHeaderLabel(cat)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFiliais.map(row => {
                const getDisplayedPct = (cat: string): number | null => {
                  if (cat === OUTROS_LABEL) {
                    const entries = outrosKeys
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
                  <td className={`${styles.tdFilial} ${styles.tdFilialClickable}`} onClick={() => navigateToFilial(row.filial)}>{row.displayName}</td>
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
                  <td className={styles.td}>{formatCurrency(row.projecao)}</td>
                  <td className={`${styles.td} ${styles.tdVendas}`}>
                    <div className={styles.vendasCell}>
                      <span>{formatCurrency(row.vendas)}</span>
                      {(() => {
                        const comparison = getComparisonBadge(row.vendas, row.vendasPrevious);
                        if (!comparison) return null;
                        const isPositive = comparison.value >= 0;
                        return (
                          <span
                            className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.vendasCompareBadge}`}
                            title={`Comparativo com ${comparisonLabel}`}
                          >
                            {`${comparison.value >= 0 ? "+" : ""}${comparison.value.toFixed(1)}%`}
                          </span>
                        );
                      })()}
                    </div>
                  </td>
                  <td className={styles.tdQtde}>{row.qtde.toLocaleString("pt-BR")}</td>
                  {displayedCategories.map(cat => {
                    if (cat === OUTROS_LABEL) {
                      const selected = outrosKeys
                        .map(c => row.categories[c])
                        .filter((v): v is CategoryData => !!v);
                      if (selected.length === 0) {
                        return <td key={cat} className={styles.tdCat}>—</td>;
                      }
                      const displayedPct = getDisplayedPct(OUTROS_LABEL);
                      const selectedDeltaPcts = selected
                        .map(v => v.deltaPct)
                        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                      const deltaPct = selectedDeltaPcts.length > 0
                        ? selectedDeltaPcts.reduce((s, v) => s + v, 0) / selectedDeltaPcts.length
                        : null;
                      const isPositive = (deltaPct ?? 0) >= 0;
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
                          title={outrosTooltip}
                        >
                          <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                          <span
                            className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                          >
                            {deltaPct !== null ? formatSignedPct(deltaPct) : "—"}
                          </span>
                        </td>
                      );
                    }

                    const catData = row.categories[cat];
                    if (!catData) {
                      return <td key={cat} className={styles.tdCat}>—</td>;
                    }
                    const isPositive = (catData.deltaPct ?? 0) >= 0;
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
                          {catData.deltaPct !== null ? formatSignedPct(catData.deltaPct) : "—"}
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
                <td className={styles.td}>{formatCurrency(totals.totalProjecao)}</td>
                <td className={`${styles.td} ${styles.tdVendas}`}>
                  <div className={styles.vendasCell}>
                    <span>{formatCurrency(totals.totalVendas)}</span>
                    {(() => {
                      const comparison = getComparisonBadge(totals.totalVendas, totals.totalVendasPrevious);
                      if (!comparison) return null;
                      const isPositive = comparison.value >= 0;
                      return (
                        <span
                          className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.vendasCompareBadge}`}
                          title={`Comparativo com ${comparisonLabel}`}
                        >
                          {`${comparison.value >= 0 ? "+" : ""}${comparison.value.toFixed(1)}%`}
                        </span>
                      );
                    })()}
                  </div>
                </td>
                <td className={styles.tdQtde}>{totals.totalQtde.toLocaleString("pt-BR")}</td>
                {(() => {
                  const getDisplayedPct = (cat: string): number | null => {
                    if (cat === OUTROS_LABEL) {
                      const entries = outrosKeys
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
                      const selected = outrosKeys
                        .map(c => totals.categoryAvg[c])
                        .filter((v): v is { pct: number; deltaPct: number | null } => !!v);
                      if (selected.length === 0) return <td key={cat} className={styles.tdCat}>—</td>;

                      const displayedPct = getDisplayedPct(OUTROS_LABEL);
                      const selectedDeltaPcts = selected
                        .map(v => v.deltaPct)
                        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                      const deltaPct = selectedDeltaPcts.length > 0
                        ? selectedDeltaPcts.reduce((s, v) => s + v, 0) / selectedDeltaPcts.length
                        : null;
                      const isPositive = (deltaPct ?? 0) >= 0;
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
                          title={outrosTooltip}
                        >
                          <span className={styles.catPct}>{displayedPct !== null ? `${displayedPct}%` : "—"}</span>
                          <span
                            className={`${styles.projecaoBadge} ${isPositive ? styles.badgeGreen : styles.badgeRed} ${styles.deltaCorner}`}
                          >
                            {deltaPct !== null ? formatSignedPct(deltaPct) : "—"}
                          </span>
                        </td>
                      );
                    }

                    const catData = totals.categoryAvg[cat];
                    if (!catData) return <td key={cat} className={styles.tdCat}>—</td>;
                    const isPositive = (catData.deltaPct ?? 0) >= 0;
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
                          {catData.deltaPct !== null ? formatSignedPct(catData.deltaPct) : "—"}
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
